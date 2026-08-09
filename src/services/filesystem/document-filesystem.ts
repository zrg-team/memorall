/**
 * Document Storage Service
 * Unified filesystem API for the agent filesystem.
 *
 * Path convention (sandbox paths):
 *   /...  →  /home/files/...
 *
 * Legacy prefixed inputs are accepted and normalized
 * to the root filesystem before storage access.
 */

import fs, { initializeFs, refreshFsCache } from "@/services/filesystem/fs";
import type { FilesystemScope } from "@/services/filesystem/filesystem-paths";
import { logInfo, logError, logDebug } from "@/utils/logger";
import type {
	DocumentFile,
	DocumentFolder,
	DocumentTreeNode,
	DocumentType,
} from "@/types/document-library";
import { BACKGROUND_EVENTS } from "@/constants/events";
import {
	isWorkspacesSandboxPath,
	normalizeSandboxPath,
	sandboxPathToFsPath,
	toDocumentsSandboxPath,
	DOCUMENTS_SANDBOX_ROOT,
	WORKSPACES_SANDBOX_ROOT,
	FILESYSTEM_SANDBOX_ROOT,
	LEGACY_DOCUMENTS_FS_ROOT,
	LEGACY_WORKSPACES_FS_ROOT,
	SANDBOX_FS_PREFIX,
	type SandboxScope,
} from "@/services/filesystem/sandbox-paths";

// Re-export so existing callers that import from this module continue to work.
export { DOCUMENTS_SANDBOX_ROOT as SANDBOX_DOCUMENTS_ROOT };
export { WORKSPACES_SANDBOX_ROOT as SANDBOX_WORKSPACE_ROOT };

const ROOT_MIGRATION_STORAGE_KEY = "memorall.filesystem.rootMigration.v1";

// ── Event types ───────────────────────────────────────────────────────────────

export interface SandboxDocumentsMountSnapshot {
	directories: string[];
	files: string[];
}

export type FilesystemChangeScope = FilesystemScope;

export type FilesystemChangeOperation =
	| "write"
	| "delete"
	| "rename"
	| "mkdir"
	| "create"
	| "move";

export interface FilesystemChangeEvent {
	scope: FilesystemChangeScope;
	operation: FilesystemChangeOperation;
	path?: string;
	oldPath?: string;
	newPath?: string;
}

const isFilesystemChangeEvent = (
	value: unknown,
): value is FilesystemChangeEvent => {
	if (!value || typeof value !== "object") return false;
	const event = value as Record<string, unknown>;
	if (
		event.scope !== "root" &&
		event.scope !== "documents" &&
		event.scope !== "workspace"
	)
		return false;
	if (typeof event.operation !== "string") return false;
	return true;
};

// ── Class ─────────────────────────────────────────────────────────────────────

export class DocumentFileSystem {
	private static instance: DocumentFileSystem;
	private initialized = false;
	private changeListeners: Set<(change: FilesystemChangeEvent | null) => void> =
		new Set();
	private messageListenerRegistered = false;
	private readonly contextId =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	private readonly processedFilesystemEventIds = new Set<string>();
	private static readonly MAX_PROCESSED_EVENT_IDS = 256;

	// Keyed by sandbox root. Root filesystem uses "/".
	// Cleared entirely on any filesystem change — simpler and always correct.
	private readonly treeCache = new Map<string, DocumentTreeNode[]>();

	private constructor() {
		this.registerMessageListener();
	}

	static getInstance(): DocumentFileSystem {
		if (!DocumentFileSystem.instance) {
			DocumentFileSystem.instance = new DocumentFileSystem();
		}
		return DocumentFileSystem.instance;
	}

	// ── Path helpers (delegate to sandbox-paths utility) ─────────────────────

	private toFsPath(sandboxPath: string): string {
		return sandboxPathToFsPath(sandboxPath.replace(/\/+$/, "") || "/");
	}

	private scopeFromPath(sandboxPath: string): SandboxScope {
		return isWorkspacesSandboxPath(sandboxPath) ? "workspace" : "root";
	}

	// ── Infrastructure ────────────────────────────────────────────────────────

	private registerMessageListener(): void {
		if (this.messageListenerRegistered) return;
		try {
			chrome.runtime.onMessage.addListener(this.handleFilesystemChangeMessage);
			this.messageListenerRegistered = true;
			logInfo("📚 Document storage message listener registered");
		} catch (error) {
			logError("Failed to register message listener:", error);
		}
	}

	onFilesystemChanged(
		callback: (change: FilesystemChangeEvent | null) => void,
	): () => void {
		this.changeListeners.add(callback);
		logInfo(
			`📝 Registered filesystem change listener (total: ${this.changeListeners.size})`,
		);
		return () => {
			this.changeListeners.delete(callback);
			logInfo(
				`📝 Unregistered filesystem change listener (remaining: ${this.changeListeners.size})`,
			);
		};
	}

	private notifyFilesystemChanged(
		change: FilesystemChangeEvent | null = null,
	): void {
		this.invalidateCache();
		logInfo(
			`📢 Notifying filesystem changed (${this.changeListeners.size} local listeners)`,
		);
		try {
			this.changeListeners.forEach((cb) => {
				try {
					cb(change);
				} catch (err) {
					logError("Error in local filesystem change listener:", err);
				}
			});
			const message = {
				type: BACKGROUND_EVENTS.FILESYSTEM_CHANGED,
				sourceContextId: this.contextId,
				eventId:
					typeof crypto !== "undefined" &&
					typeof crypto.randomUUID === "function"
						? crypto.randomUUID()
						: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				change,
				relayedByBackground: false,
			};
			chrome.runtime.sendMessage(message).catch((err: Error) => {
				if (
					!err.message?.includes("Receiving end does not exist") &&
					!err.message?.includes("Could not establish connection")
				) {
					logError("Failed to send filesystem change notification:", err);
				} else {
					logInfo(
						"📭 No receivers for filesystem change notification (normal)",
					);
				}
			});
			logInfo("✅ Filesystem change notifications sent");
		} catch (error) {
			logError("Failed to notify filesystem change:", error);
			this.changeListeners.forEach((cb) => {
				try {
					cb(change);
				} catch (err) {
					logError("Error in local filesystem change listener:", err);
				}
			});
		}
	}

	private invalidateCache(): void {
		this.treeCache.clear();
	}

	private async invalidateCacheAndRefreshFs(): Promise<void> {
		this.invalidateCache();
		await refreshFsCache();
	}

	public forceRefresh(): void {
		logInfo("🔄 Force refreshing document storage cache");
		this.invalidateCache();
	}

	private handleFilesystemChangeMessage = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		_sendResponse: (response?: unknown) => void,
	): void => {
		if (
			message &&
			typeof message === "object" &&
			"type" in message &&
			message.type === BACKGROUND_EVENTS.FILESYSTEM_CHANGED
		) {
			const sourceContextId =
				"sourceContextId" in message &&
				typeof message.sourceContextId === "string"
					? message.sourceContextId
					: null;
			const eventId =
				"eventId" in message && typeof message.eventId === "string"
					? message.eventId
					: null;
			const change =
				"change" in message && isFilesystemChangeEvent(message.change)
					? message.change
					: null;

			if (eventId && this.processedFilesystemEventIds.has(eventId)) {
				logDebug(`Ignoring duplicate FILESYSTEM_CHANGED event: ${eventId}`);
				return;
			}
			if (eventId) {
				this.processedFilesystemEventIds.add(eventId);
				if (
					this.processedFilesystemEventIds.size >
					DocumentFileSystem.MAX_PROCESSED_EVENT_IDS
				) {
					const first = this.processedFilesystemEventIds.values().next().value;
					if (first) this.processedFilesystemEventIds.delete(first);
				}
			}
			if (sourceContextId && sourceContextId === this.contextId) {
				logDebug("Ignoring self-originated FILESYSTEM_CHANGED message");
				return;
			}
			logInfo(
				`📢 Received FILESYSTEM_CHANGED from ${sender.id || "unknown"} (${this.changeListeners.size} listeners)`,
			);
			this.invalidateCacheAndRefreshFs().catch((err) => {
				logError("Failed to refresh FS cache:", err);
			});
			let notifiedCount = 0;
			this.changeListeners.forEach((cb) => {
				try {
					cb(change);
					notifiedCount++;
				} catch (err) {
					logError("Error in filesystem change listener:", err);
				}
			});
			logInfo(`✅ Notified ${notifiedCount} local listeners`);
		}
	};

	async initialize(): Promise<void> {
		if (this.initialized) return;
		try {
			await initializeFs();
			await this.ensureDirectory(SANDBOX_FS_PREFIX);
			await this.migrateLegacyRootsToRoot();
			this.initialized = true;
			logInfo("📚 Document storage initialized");
		} catch (error) {
			logError("Failed to initialize document storage:", error);
			throw error;
		}
	}

	private async isRootMigrationComplete(): Promise<boolean> {
		try {
			if (typeof chrome === "undefined" || !chrome.storage?.local) {
				return false;
			}
			const result = await chrome.storage?.local?.get?.(
				ROOT_MIGRATION_STORAGE_KEY,
			);
			return result?.[ROOT_MIGRATION_STORAGE_KEY] === true;
		} catch {
			return false;
		}
	}

	private async markRootMigrationComplete(): Promise<void> {
		try {
			if (typeof chrome === "undefined" || !chrome.storage?.local) {
				return;
			}
			await chrome.storage?.local?.set?.({
				[ROOT_MIGRATION_STORAGE_KEY]: true,
			});
		} catch {
			// Non-extension test/runtime contexts can still use the migrated root.
		}
	}

	private async pathExists(path: string): Promise<boolean> {
		try {
			await fs.promises.stat(path);
			return true;
		} catch (error) {
			return !this.isNotFoundError(error);
		}
	}

	private async filesAreEqual(pathA: string, pathB: string): Promise<boolean> {
		const [a, b] = await Promise.all([
			fs.promises.readFile(pathA),
			fs.promises.readFile(pathB),
		]);
		if (a.length !== b.length) return false;
		for (let index = 0; index < a.length; index++) {
			if (a[index] !== b[index]) return false;
		}
		return true;
	}

	private async moveLegacyEntryIntoRoot(
		sourcePath: string,
		destinationPath: string,
		fromWorkspace: boolean,
	): Promise<void> {
		const sourceStat = await fs.promises.stat(sourcePath);
		if (sourceStat.isDirectory()) {
			await this.ensureDirectory(destinationPath);
			const entries = await fs.promises.readdir(sourcePath, {
				withFileTypes: true,
			});
			for (const entry of entries) {
				await this.moveLegacyEntryIntoRoot(
					`${sourcePath}/${entry.name}`,
					`${destinationPath}/${entry.name}`,
					fromWorkspace,
				);
			}
			await fs.promises.rmdir(sourcePath).catch(() => undefined);
			return;
		}

		if (!(await this.pathExists(destinationPath))) {
			await this.ensureDirectory(
				destinationPath.substring(0, destinationPath.lastIndexOf("/")),
			);
			await fs.promises.rename(sourcePath, destinationPath);
			return;
		}

		if (await this.filesAreEqual(sourcePath, destinationPath)) {
			await fs.promises.unlink(sourcePath);
			return;
		}

		const dirPath = destinationPath.substring(
			0,
			destinationPath.lastIndexOf("/"),
		);
		const fileName = destinationPath.slice(
			destinationPath.lastIndexOf("/") + 1,
		);
		const conflictName = fromWorkspace
			? fileName.replace(/(\.[^.]*)?$/, " (from workspace)$1")
			: fileName.replace(/(\.[^.]*)?$/, " (from documents)$1");
		const dedupedName = await this.deduplicateName(dirPath, conflictName);
		await fs.promises.rename(sourcePath, `${dirPath}/${dedupedName}`);
	}

	private async migrateLegacyRoot(
		legacyRoot: string,
		fromWorkspace: boolean,
	): Promise<void> {
		try {
			const stat = await fs.promises.stat(legacyRoot);
			if (!stat.isDirectory()) return;
		} catch (error) {
			if (this.isNotFoundError(error)) return;
			throw error;
		}

		const entries = await fs.promises.readdir(legacyRoot, {
			withFileTypes: true,
		});
		for (const entry of entries) {
			await this.moveLegacyEntryIntoRoot(
				`${legacyRoot}/${entry.name}`,
				`${SANDBOX_FS_PREFIX}/${entry.name}`,
				fromWorkspace,
			);
		}
		await fs.promises.rmdir(legacyRoot).catch(() => undefined);
	}

	private async migrateLegacyRootsToRoot(): Promise<void> {
		if (await this.isRootMigrationComplete()) return;
		await this.migrateLegacyRoot(LEGACY_DOCUMENTS_FS_ROOT, false);
		await this.migrateLegacyRoot(LEGACY_WORKSPACES_FS_ROOT, true);
		await this.markRootMigrationComplete();
	}

	// ── Private filesystem helpers ────────────────────────────────────────────

	private isNotFoundError(error: unknown): boolean {
		return !!(
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		);
	}

	private async ensureDirectory(fullPath: string): Promise<void> {
		await initializeFs();
		fullPath = fullPath.replace(/\\/g, "/");
		const segments = fullPath.split("/").filter(Boolean);
		if (segments.length === 0) return;
		let currentPath = "";
		for (let i = 0; i < segments.length; i++) {
			currentPath += "/" + segments[i];
			logDebug(
				`📂 Checking directory segment ${i + 1}/${segments.length}: ${currentPath}`,
			);
			try {
				const stat = await fs.promises.stat(currentPath);
				if (!stat.isDirectory()) {
					throw new Error(`Path exists but is not a directory: ${currentPath}`);
				}
				logDebug(`✓ Directory exists: ${currentPath}`);
			} catch (err) {
				const isNotFound =
					err &&
					typeof err === "object" &&
					"code" in err &&
					err.code === "ENOENT";
				if (isNotFound) {
					logDebug(`📁 Directory not found, creating: ${currentPath}`);
					try {
						await fs.promises.mkdir(currentPath, { recursive: true });
						logInfo(`📁 Created directory segment: ${currentPath}`);
					} catch (mkdirErr) {
						const isDirExists =
							mkdirErr &&
							typeof mkdirErr === "object" &&
							"code" in mkdirErr &&
							mkdirErr.code === "EEXIST";
						if (!isDirExists) {
							logError(`Failed to create directory ${currentPath}:`, mkdirErr);
							throw mkdirErr;
						}
						logDebug(
							`✓ Directory already exists (race condition): ${currentPath}`,
						);
					}
				} else {
					logError(`Error checking directory ${currentPath}:`, err);
					throw err;
				}
			}
		}
		logInfo(`✅ Directory path ensured: ${fullPath}`);
	}

	private getDocumentType(mimeType: string, fileName?: string): DocumentType {
		if (mimeType.startsWith("application/pdf")) return "pdf";
		if (mimeType.startsWith("text/plain")) return "text";
		if (mimeType.includes("markdown")) return "markdown";
		if (mimeType.startsWith("image/")) return "image";
		if (
			mimeType === "application/vnd.ms-excel" ||
			mimeType ===
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
			mimeType === "application/vnd.ms-excel.sheet.macroEnabled.12"
		)
			return "excel";
		if (fileName) {
			const ext = fileName.toLowerCase().split(".").pop();
			if (ext) {
				if (ext === "pdf") return "pdf";
				if (ext === "txt") return "text";
				if (ext === "md" || ext === "markdown") return "markdown";
				if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
				if (["xls", "xlsx", "xlsm"].includes(ext)) return "excel";
			}
		}
		return "other";
	}

	private getMimeTypeFromExtension(fileName: string): string {
		const ext = fileName.toLowerCase().split(".").pop();
		if (!ext) return "application/octet-stream";
		const mimeTypes: Record<string, string> = {
			pdf: "application/pdf",
			txt: "text/plain",
			md: "text/markdown",
			markdown: "text/markdown",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			png: "image/png",
			gif: "image/gif",
			webp: "image/webp",
			xls: "application/vnd.ms-excel",
			xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
		};
		return mimeTypes[ext] ?? "application/octet-stream";
	}

	private parseFileName(fileName: string): { name: string; ext: string } {
		const lastDotIndex = fileName.lastIndexOf(".");
		if (lastDotIndex === -1) return { name: fileName, ext: "" };
		return {
			name: fileName.substring(0, lastDotIndex),
			ext: fileName.substring(lastDotIndex),
		};
	}

	private async scanDirectory(
		fsPath: string,
		logicalPath: string,
	): Promise<DocumentTreeNode[]> {
		const nodes: DocumentTreeNode[] = [];
		try {
			const entries = await fs.promises.readdir(fsPath, {
				withFileTypes: true,
			});
			for (const entry of entries) {
				const fullFsPath = `${fsPath}/${entry.name}`;
				const fullLogicalPath =
					logicalPath === "/"
						? `/${entry.name}`
						: `${logicalPath}/${entry.name}`;
				if (entry.isDirectory()) {
					const children = await this.scanDirectory(
						fullFsPath,
						fullLogicalPath,
					);
					const folder: DocumentFolder = {
						id: fullLogicalPath,
						name: entry.name,
						path: fullLogicalPath,
						parentPath: logicalPath === "/" ? null : logicalPath,
						createdAt: new Date(),
						modifiedAt: new Date(),
						childCount: children.length,
					};
					nodes.push({
						id: folder.id,
						name: entry.name,
						path: fullLogicalPath,
						type: "folder",
						isExpanded: false,
						children,
						folder,
					});
				} else if (entry.isFile()) {
					try {
						const stats = await fs.promises.stat(fullFsPath);
						const mimeType = this.getMimeTypeFromExtension(entry.name);
						const file: DocumentFile = {
							id: fullLogicalPath,
							name: entry.name,
							path: fullLogicalPath,
							type: this.getDocumentType("", entry.name),
							mimeType,
							size: stats.size,
							createdAt: new Date(stats.birthtime ?? stats.mtime),
							modifiedAt: new Date(stats.mtime),
							metadata: {},
						};
						nodes.push({
							id: file.id,
							name: entry.name,
							path: fullLogicalPath,
							type: "file",
							isExpanded: false,
							children: [],
							file,
						});
					} catch (error) {
						if (!this.isNotFoundError(error)) {
							logError(`Failed to stat file ${fullFsPath}:`, error);
						}
					}
				}
			}
		} catch (error) {
			if (!this.isNotFoundError(error)) {
				logError(`Failed to scan directory ${fsPath}:`, error);
			} else {
				logDebug(
					`Directory not found while scanning (treated as empty): ${fsPath}`,
				);
			}
		}
		return nodes;
	}

	private async deleteDirectoryRecursive(path: string): Promise<void> {
		const entries = await fs.promises.readdir(path, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = `${path}/${entry.name}`;
			if (entry.isDirectory()) {
				await this.deleteDirectoryRecursive(fullPath);
			} else {
				await fs.promises.unlink(fullPath);
			}
		}
		await fs.promises.rmdir(path);
	}

	private async copyDirectory(
		source: string,
		destination: string,
	): Promise<void> {
		await fs.promises.mkdir(destination, { recursive: true });
		const entries = await fs.promises.readdir(source, { withFileTypes: true });
		for (const entry of entries) {
			const srcPath = `${source}/${entry.name}`;
			const destPath = `${destination}/${entry.name}`;
			if (entry.isDirectory()) {
				await this.copyDirectory(srcPath, destPath);
			} else {
				const content = await fs.promises.readFile(srcPath);
				await fs.promises.writeFile(destPath, content);
			}
		}
	}

	/** Deduplicate a filename within a directory, returning the final name to use. */
	private async deduplicateName(
		dirFsPath: string,
		fileName: string,
	): Promise<string> {
		try {
			await fs.promises.stat(`${dirFsPath}/${fileName}`);
		} catch {
			return fileName; // Does not exist — use as-is.
		}
		const { name: baseName, ext } = this.parseFileName(fileName);
		let counter = 1;
		while (true) {
			const candidate = `${baseName} (${counter})${ext}`;
			try {
				await fs.promises.stat(`${dirFsPath}/${candidate}`);
				counter++;
			} catch {
				return candidate;
			}
		}
	}

	// ── Unified public API ────────────────────────────────────────────────────

	/**
	 * Read a file. Public paths are rooted at "/"; legacy namespace prefixes are
	 * normalized before access.
	 */
	async readFile(sandboxPath: string): Promise<Uint8Array> {
		await this.initialize();
		const fsPath = this.toFsPath(sandboxPath);
		try {
			return await fs.promises.readFile(fsPath);
		} catch {
			throw new Error(`File not found: ${sandboxPath}`);
		}
	}

	/**
	 * Write content to a file, creating parent directories as needed.
	 * Pass notify=false for silent content saves (e.g. in-editor autosave)
	 * that should not trigger a tree reload.
	 */
	async writeFile(
		sandboxPath: string,
		content: string | Uint8Array,
		notify = true,
	): Promise<void> {
		await this.initialize();
		const fsPath = this.toFsPath(sandboxPath);
		const dirPath = fsPath.substring(0, fsPath.lastIndexOf("/"));
		await this.ensureDirectory(dirPath);

		let operation: FilesystemChangeOperation = "create";
		try {
			await fs.promises.stat(fsPath);
			operation = "write";
		} catch (err) {
			if (!this.isNotFoundError(err)) throw err;
		}

		const doWrite = async (): Promise<void> => {
			if (typeof content === "string") {
				await fs.promises.writeFile(fsPath, content, {
					encoding: "utf8",
					flag: "w",
				});
			} else {
				await fs.promises.writeFile(fsPath, content);
			}
		};

		try {
			await doWrite();
		} catch (err) {
			if (!this.isNotFoundError(err)) throw err;
			// IndexedDB-backed ZenFS can briefly miss a newly-created parent across
			// contexts. Re-ensure the directory and retry once.
			await this.ensureDirectory(dirPath);
			await doWrite();
		}

		if (notify) {
			this.notifyFilesystemChanged({
				scope: this.scopeFromPath(sandboxPath),
				operation,
				path: sandboxPath,
			});
		}
	}

	/**
	 * Upload a File object into the filesystem.
	 * Always reads as binary (arrayBuffer) — correct for all file types.
	 * Deduplicates the filename if a file already exists at the target.
	 *
	 * @param sandboxPath  Target folder path (default: filesystem root).
	 * @param metadata     Optional metadata to attach to the returned DocumentFile.
	 */
	async uploadFile(
		file: File,
		sandboxPath: string = DOCUMENTS_SANDBOX_ROOT,
		metadata?: DocumentFile["metadata"],
	): Promise<DocumentFile> {
		await this.initialize();
		const folderFsPath = this.toFsPath(sandboxPath);
		await this.ensureDirectory(folderFsPath);

		const fileName = await this.deduplicateName(folderFsPath, file.name);
		const fileFsPath = `${folderFsPath}/${fileName}`;

		const bytes = new Uint8Array(await file.arrayBuffer());

		// Write with retry — ZenFS/IndexedDB can be transiently flaky.
		let attempts = 0;
		while (true) {
			try {
				await fs.promises.writeFile(fileFsPath, bytes);
				break;
			} catch (err) {
				attempts++;
				if (attempts >= 3) throw err;
				await this.ensureDirectory(folderFsPath);
				await new Promise<void>((resolve) => setTimeout(resolve, 100));
			}
		}

		const normalizedSandboxPath = normalizeSandboxPath(sandboxPath);
		const logicalFolder = normalizedSandboxPath;
		const logicalFilePath =
			logicalFolder === "/" ? `/${fileName}` : `${logicalFolder}/${fileName}`;

		const docFile: DocumentFile = {
			id: logicalFilePath,
			name: fileName,
			path: logicalFilePath,
			type: this.getDocumentType(file.type, fileName),
			mimeType: file.type,
			size: bytes.length,
			createdAt: new Date(),
			modifiedAt: new Date(),
			metadata: metadata ?? {},
		};

		logInfo(`📄 Uploaded file: ${docFile.path}`);
		this.notifyFilesystemChanged({
			scope: this.scopeFromPath(sandboxPath),
			operation: "create",
			path: logicalFilePath,
		});

		return docFile;
	}

	/**
	 * Delete a file at the given sandbox path.
	 */
	async deleteFile(sandboxPath: string): Promise<void> {
		await this.initialize();
		const fsPath = this.toFsPath(sandboxPath);
		await fs.promises.unlink(fsPath);
		logInfo(`🗑️ Deleted file: ${sandboxPath}`);
		this.notifyFilesystemChanged({
			scope: this.scopeFromPath(sandboxPath),
			operation: "delete",
			path: sandboxPath,
		});
	}

	/**
	 * Recursively delete a folder at the given sandbox path.
	 */
	async deleteFolder(sandboxPath: string): Promise<void> {
		await this.initialize();
		const fsPath = this.toFsPath(sandboxPath);
		const stats = await fs.promises.stat(fsPath);
		if (!stats.isDirectory()) {
			throw new Error(`Not a directory: ${sandboxPath}`);
		}
		await this.deleteDirectoryRecursive(fsPath);
		logInfo(`🗑️ Deleted folder: ${sandboxPath}`);
		this.notifyFilesystemChanged({
			scope: this.scopeFromPath(sandboxPath),
			operation: "delete",
			path: sandboxPath,
		});
	}

	/**
	 * Rename or move a file or folder to an exact sandbox path.
	 * Returns the normalized destination path.
	 */
	async renamePath(
		sandboxPath: string,
		newSandboxPath: string,
	): Promise<string> {
		await this.initialize();
		const normalizedSourcePath = normalizeSandboxPath(sandboxPath);
		const normalizedDestinationPath = normalizeSandboxPath(newSandboxPath);
		const oldFsPath = this.toFsPath(normalizedSourcePath);
		const newFsPath = this.toFsPath(normalizedDestinationPath);

		try {
			await fs.promises.stat(newFsPath);
			throw new Error(`"${normalizedDestinationPath}" already exists`);
		} catch (err) {
			if (err instanceof Error && err.message.includes("already exists")) {
				throw err;
			}
		}

		await fs.promises.rename(oldFsPath, newFsPath);
		logInfo(
			`📝 Renamed: ${normalizedSourcePath} → ${normalizedDestinationPath}`,
		);
		this.notifyFilesystemChanged({
			scope: this.scopeFromPath(normalizedSourcePath),
			operation: "rename",
			oldPath: normalizedSourcePath,
			newPath: normalizedDestinationPath,
		});
		return normalizedDestinationPath;
	}

	/**
	 * Rename a file or folder. Works for both.
	 * Returns the new sandbox path.
	 */
	async rename(sandboxPath: string, newName: string): Promise<string> {
		const normalizedSandboxPath = normalizeSandboxPath(sandboxPath);
		const parentSandboxPath =
			normalizedSandboxPath.substring(
				0,
				normalizedSandboxPath.lastIndexOf("/"),
			) || "/";
		const newSandboxPath =
			parentSandboxPath === "/"
				? `/${newName}`
				: `${parentSandboxPath}/${newName}`;
		return this.renamePath(normalizedSandboxPath, newSandboxPath);
	}

	/**
	 * Move a file or folder to a target folder. Works for both files and directories.
	 * Deduplicates the name at the destination.
	 * Returns the new sandbox path.
	 */
	async move(
		sandboxPath: string,
		targetFolderSandboxPath: string,
	): Promise<string> {
		await this.initialize();
		const srcFsPath = this.toFsPath(sandboxPath);
		const targetFsFolderPath = this.toFsPath(targetFolderSandboxPath);

		if (
			targetFsFolderPath === srcFsPath ||
			targetFsFolderPath.startsWith(`${srcFsPath}/`)
		) {
			throw new Error("Cannot move an item into itself or its subdirectories");
		}

		await this.ensureDirectory(targetFsFolderPath);

		const name = srcFsPath.split("/").pop()!;
		const finalName = await this.deduplicateName(targetFsFolderPath, name);
		const destFsPath = `${targetFsFolderPath}/${finalName}`;

		const stats = await fs.promises.stat(srcFsPath);
		if (stats.isDirectory()) {
			await this.copyDirectory(srcFsPath, destFsPath);
			await this.deleteDirectoryRecursive(srcFsPath);
		} else {
			const content = await fs.promises.readFile(srcFsPath);
			await fs.promises.writeFile(destFsPath, content);
			await fs.promises.unlink(srcFsPath);
		}

		const normalizedTargetFolder = normalizeSandboxPath(
			targetFolderSandboxPath,
		);
		const newSandboxPath =
			normalizedTargetFolder === "/"
				? `/${finalName}`
				: `${normalizedTargetFolder}/${finalName}`;
		logInfo(`✅ Moved: ${sandboxPath} → ${newSandboxPath}`);
		this.notifyFilesystemChanged({
			scope: this.scopeFromPath(sandboxPath),
			operation: "move",
			oldPath: sandboxPath,
			newPath: newSandboxPath,
		});
		return newSandboxPath;
	}

	/**
	 * Create a directory (and all parents) at the given sandbox path.
	 */
	async mkdir(sandboxPath: string): Promise<void> {
		await this.initialize();
		const fsPath = this.toFsPath(sandboxPath);
		await this.ensureDirectory(fsPath);
		this.notifyFilesystemChanged({
			scope: this.scopeFromPath(sandboxPath),
			operation: "mkdir",
			path: sandboxPath,
		});
	}

	/**
	 * Scan the filesystem under sandboxRoot and return a tree of DocumentTreeNode.
	 * sandboxRoot is normalized to the single root filesystem.
	 * Tree node paths are logical (relative to the root, starting with "/").
	 * Results are cached until the next filesystem change.
	 */
	async getTree(sandboxRoot: string): Promise<DocumentTreeNode[]> {
		await this.initialize();
		const normalizedRoot = normalizeSandboxPath(sandboxRoot);
		const fsRoot = this.toFsPath(normalizedRoot);
		await this.ensureDirectory(fsRoot);

		const cached = this.treeCache.get(FILESYSTEM_SANDBOX_ROOT);
		if (cached !== undefined) {
			logInfo("📦 Returning cached tree data");
			return cached;
		}

		logInfo("🔄 Fetching fresh tree data");
		const fresh = await this.scanDirectory(fsRoot, "/");
		this.treeCache.set(FILESYSTEM_SANDBOX_ROOT, fresh);
		return fresh;
	}

	// ── Specialized methods ───────────────────────────────────────────────────

	/**
	 * Upload an image from the chat input.
	 * Stores under /resources/images/ with a UUID filename.
	 * Returns the logical path (e.g. /resources/images/<uuid>.png).
	 */
	async uploadChatImage(file: File): Promise<string> {
		await this.initialize();
		const ext = file.name.includes(".")
			? file.name.slice(file.name.lastIndexOf("."))
			: "";
		const uuid =
			typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
				? crypto.randomUUID()
				: `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const fileName = `${uuid}${ext}`;
		const targetDir = `${SANDBOX_FS_PREFIX}/resources/images`;
		await this.ensureDirectory(targetDir);
		const fullPath = `${targetDir}/${fileName}`;
		const arrayBuffer = await file.arrayBuffer();
		await fs.promises.writeFile(fullPath, new Uint8Array(arrayBuffer));
		logInfo(`🖼️ Uploaded chat image: ${fullPath}`);
		return `/resources/images/${fileName}`;
	}

	/**
	 * Read a filesystem file by its logical path and return a base64 data URI.
	 * @param logicalPath  Root path (e.g. /resources/images/uuid.png).
	 * @param mimeType     MIME type for the data URI.
	 */
	async readFileAsBase64(
		logicalPath: string,
		mimeType: string,
	): Promise<string> {
		const bytes = await this.readFile(toDocumentsSandboxPath(logicalPath));
		let binary = "";
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return `data:${mimeType};base64,${btoa(binary)}`;
	}

	/**
	 * Build a root mount snapshot for the sandbox runtime.
	 */
	async getSandboxMountSnapshot(): Promise<SandboxDocumentsMountSnapshot> {
		await this.initialize();
		const directories = new Set<string>([FILESYSTEM_SANDBOX_ROOT]);
		const files = new Set<string>();
		const tree = await this.getTree(FILESYSTEM_SANDBOX_ROOT);

		const toMountSandboxPath = (logicalPath: string): string | null => {
			if (!logicalPath.startsWith("/")) return null;
			const segments = logicalPath
				.replace(/\\/g, "/")
				.split("/")
				.filter(Boolean);
			for (const segment of segments) {
				if (segment === "." || segment === ".." || segment.includes("\0"))
					return null;
			}
			return toDocumentsSandboxPath(
				segments.length === 0 ? "/" : `/${segments.join("/")}`,
			);
		};

		const ensureParentDirectories = (fullPath: string): void => {
			const segments = fullPath.split("/").filter(Boolean);
			let current = "";
			for (let i = 0; i < segments.length - 1; i++) {
				current += `/${segments[i]}`;
				directories.add(current);
			}
		};

		const walk = (nodes: DocumentTreeNode[]): void => {
			for (const node of nodes) {
				const sp = toMountSandboxPath(node.path);
				if (!sp) continue;
				if (node.type === "folder") {
					directories.add(sp);
				} else if (node.type === "file") {
					files.add(sp);
					ensureParentDirectories(sp);
				}
				if (node.children?.length) walk(node.children);
			}
		};

		walk(tree);
		return {
			directories: Array.from(directories).sort(),
			files: Array.from(files).sort(),
		};
	}

	/**
	 * Compatibility wrapper for callers that still ask for the old workspace
	 * mount. The sandbox now receives the same single root snapshot.
	 */
	async getSandboxWorkspaceMountSnapshot(): Promise<SandboxDocumentsMountSnapshot> {
		return this.getSandboxMountSnapshot();
	}
}

export const documentFileSystemService = DocumentFileSystem.getInstance();
