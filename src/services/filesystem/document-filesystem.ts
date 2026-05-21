/**
 * Simple Document Storage Service
 * Direct filesystem operations without metadata
 */

import fs, { initializeFs, refreshFsCache } from "@/services/filesystem/fs";
import { logInfo, logError, logDebug } from "@/utils/logger";
import type {
	DocumentFile,
	DocumentFolder,
	DocumentTreeNode,
	DocumentType,
} from "@/types/document-library";
import { BACKGROUND_EVENTS } from "@/constants/events";

const DOCUMENTS_ROOT = "/home/documents";
const SANDBOX_DOCUMENTS_ROOT = "/documents";
const WORKSPACE_ROOT = "/home/workspace";
const SANDBOX_WORKSPACE_ROOT = "/workspaces";
const SANDBOX_WORKSPACE_LEGACY_ROOT = "/workspace";

export interface SandboxDocumentsMountSnapshot {
	directories: string[];
	files: string[];
}

export type FilesystemChangeScope = "documents" | "workspace";

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
	if (!value || typeof value !== "object") {
		return false;
	}
	const event = value as Record<string, unknown>;
	if (event.scope !== "documents" && event.scope !== "workspace") {
		return false;
	}
	if (typeof event.operation !== "string") {
		return false;
	}
	return true;
};

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

	// Internal cache with invalidation
	private treeCache: DocumentTreeNode[] | null = null;
	private treeCacheValid = false;

	private isNotFoundError(error: unknown): boolean {
		return !!(
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		);
	}

	private constructor() {
		// Register message listener immediately when service is created
		// This ensures we can receive notifications from other contexts right away
		this.registerMessageListener();
	}

	static getInstance(): DocumentFileSystem {
		if (!DocumentFileSystem.instance) {
			DocumentFileSystem.instance = new DocumentFileSystem();
		}
		return DocumentFileSystem.instance;
	}

	/**
	 * Register the cross-context message listener
	 * Called automatically in constructor to ensure it's always ready
	 */
	private registerMessageListener(): void {
		if (this.messageListenerRegistered) return;

		try {
			chrome.runtime.onMessage.addListener(this.handleFilesystemChangeMessage);
			this.messageListenerRegistered = true;
			logInfo("📚 Document storage message listener registered");
		} catch (error) {
			// In non-extension contexts, this will fail - that's okay
			logError("Failed to register message listener:", error);
		}
	}

	/**
	 * Register a listener for filesystem changes from other contexts
	 * This allows UI components to react to changes made in other contexts (offscreen, popup, etc.)
	 */
	onFilesystemChanged(
		callback: (change: FilesystemChangeEvent | null) => void,
	): () => void {
		this.changeListeners.add(callback);
		logInfo(
			`📝 Registered filesystem change listener (total: ${this.changeListeners.size})`,
		);

		// Return unsubscribe function
		return () => {
			this.changeListeners.delete(callback);
			logInfo(
				`📝 Unregistered filesystem change listener (remaining: ${this.changeListeners.size})`,
			);
		};
	}

	/**
	 * Notify all contexts (including this one) that the filesystem has changed
	 * Uses chrome.runtime.sendMessage which broadcasts to ALL extension contexts automatically:
	 * - Background service worker
	 * - Popup windows
	 * - Offscreen documents
	 * - Options pages
	 * - Extension tabs
	 *
	 * No relay needed in MV3 - the message reaches all contexts directly!
	 */
	private notifyFilesystemChanged(
		change: FilesystemChangeEvent | null = null,
	): void {
		// CRITICAL: Invalidate cache FIRST before notifying anyone
		this.invalidateCache();

		logInfo(
			`📢 Notifying filesystem changed (${this.changeListeners.size} local listeners)`,
		);

		try {
			// Immediately notify local listeners
			this.changeListeners.forEach((callback) => {
				try {
					callback(change);
				} catch (error) {
					logError("Error in local filesystem change listener:", error);
				}
			});

			// Then broadcast to ALL other extension contexts (MV3 auto-broadcast)
			// IMPORTANT: In MV3, messages from offscreen/background may not reach popup
			// reliably, so we also send to background worker explicitly
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
				// Ignore "no receiver" errors (expected when no other contexts are open)
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
			// In non-extension context, this might fail - notify local listeners anyway
			logError("Failed to notify filesystem change:", error);

			// Still notify local listeners even if broadcasting fails
			this.changeListeners.forEach((callback) => {
				try {
					callback(change);
				} catch (callbackError) {
					logError("Error in local filesystem change listener:", callbackError);
				}
			});
		}
	}

	/**
	 * Invalidate internal cache
	 * Called when filesystem changes in ANY context
	 */
	private invalidateCache(): void {
		this.treeCacheValid = false;
		this.treeCache = null;
	}

	/**
	 * Invalidate internal cache AND refresh ZenFS cache
	 * This ensures we get fresh data from IndexedDB when files are modified in other contexts
	 */
	private async invalidateCacheAndRefreshFs(): Promise<void> {
		this.invalidateCache();
		await refreshFsCache();
	}

	/**
	 * Public method to force cache invalidation
	 * Use this when you want to ensure fresh data is loaded (e.g., when opening a page)
	 */
	public forceRefresh(): void {
		logInfo("🔄 Force refreshing document storage cache");
		this.invalidateCache();
	}

	/**
	 * Handle filesystem change messages from other contexts
	 * IMPORTANT: Must not return a value or return undefined for synchronous handling
	 * Returning true would indicate async response, but we handle everything sync
	 */
	private handleFilesystemChangeMessage = (
		message: unknown,
		sender: chrome.runtime.MessageSender,
		_sendResponse: (response?: unknown) => void,
	): void => {
		// Type guard for message structure
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

			// Ignore messages emitted by this exact context.
			// Local listeners were already notified in notifyFilesystemChanged().
			if (sourceContextId && sourceContextId === this.contextId) {
				logDebug("Ignoring self-originated FILESYSTEM_CHANGED message");
				return;
			}

			logInfo(
				`📢 Received FILESYSTEM_CHANGED from ${sender.id || "unknown"} (${this.changeListeners.size} listeners)`,
			);

			// CRITICAL: Invalidate cache AND refresh ZenFS cache when receiving notification
			// This ensures we get fresh data from IndexedDB (async but fire-and-forget)
			this.invalidateCacheAndRefreshFs().catch((err) => {
				logError("Failed to refresh FS cache:", err);
			});

			// Notify all registered listeners synchronously
			let notifiedCount = 0;
			this.changeListeners.forEach((callback) => {
				try {
					callback(change);
					notifiedCount++;
				} catch (error) {
					logError("Error in filesystem change listener:", error);
				}
			});

			logInfo(`✅ Notified ${notifiedCount} local listeners`);
		}
		// Don't return anything - synchronous handling
	};

	/**
	 * Initialize the document storage system
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			// Wait for filesystem to be ready
			await initializeFs();

			// Ensure documents directory exists
			await this.ensureDirectory(DOCUMENTS_ROOT);

			this.initialized = true;
			logInfo("📚 Document storage initialized");
		} catch (error) {
			logError("Failed to initialize document storage:", error);
			throw error;
		}
	}

	private async ensureDirectory(fullPath: string): Promise<void> {
		// Make sure ZenFS is ready
		await initializeFs();

		// Normalize slashes
		fullPath = fullPath.replace(/\\/g, "/");

		// Remove empty segments and rebuild path
		const segments = fullPath.split("/").filter(Boolean);

		if (segments.length === 0) return;

		// Create directories one by one from root to target
		// This is more reliable than relying on {recursive: true} in ZenFS
		let currentPath = "";
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			currentPath += "/" + segment;

			logDebug(
				`📂 Checking directory segment ${i + 1}/${segments.length}: ${currentPath}`,
			);

			try {
				const stat = await fs.promises.stat(currentPath);

				// If exists but is NOT directory → error
				if (!stat.isDirectory()) {
					throw new Error(`Path exists but is not a directory: ${currentPath}`);
				}

				// Directory already exists, continue to next segment
				logDebug(`✓ Directory exists: ${currentPath}`);
				continue;
			} catch (err) {
				// Check if it's a filesystem error with ENOENT code
				const isNotFound =
					err &&
					typeof err === "object" &&
					"code" in err &&
					err.code === "ENOENT";

				// If directory doesn't exist, create it
				if (isNotFound) {
					logDebug(`📁 Directory not found, creating: ${currentPath}`);
					try {
						// Use recursive option as fallback safety measure
						await fs.promises.mkdir(currentPath, { recursive: true });
						logInfo(`📁 Created directory segment: ${currentPath}`);
					} catch (mkdirErr) {
						// Ignore if directory was just created by another process
						const isDirExists =
							mkdirErr &&
							typeof mkdirErr === "object" &&
							"code" in mkdirErr &&
							mkdirErr.code === "EEXIST";

						if (!isDirExists) {
							logError(`Failed to create directory ${currentPath}:`, mkdirErr);
							logError(`Full path being ensured: ${fullPath}`);
							logError(`Current segment: ${i + 1}/${segments.length}`);
							throw mkdirErr;
						} else {
							logDebug(
								`✓ Directory already exists (race condition): ${currentPath}`,
							);
						}
					}
				} else {
					// Other error, rethrow
					logError(`Error checking directory ${currentPath}:`, err);
					logError(`Full path being ensured: ${fullPath}`);
					throw err;
				}
			}
		}

		logInfo(`✅ Directory path ensured: ${fullPath}`);
	}

	/**
	 * Get document type from MIME type and filename
	 */
	private getDocumentType(mimeType: string, fileName?: string): DocumentType {
		// Check MIME type first
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

		// Fallback to file extension
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

	/**
	 * Upload a document file
	 */
	async uploadFile(
		file: File,
		targetPath: string = "/",
		metadata?: DocumentFile["metadata"],
	): Promise<DocumentFile> {
		await this.initialize();

		const normalizedPath = this.normalizePath(targetPath);
		let fileName = file.name;
		let fullPath = `${DOCUMENTS_ROOT}${normalizedPath}/${fileName}`;

		try {
			// Ensure target directory exists BEFORE checking if file exists
			logInfo(
				`📂 Ensuring directory exists: ${DOCUMENTS_ROOT}${normalizedPath}`,
			);
			await this.ensureDirectory(`${DOCUMENTS_ROOT}${normalizedPath}`);
			logInfo(`✅ Directory confirmed: ${DOCUMENTS_ROOT}${normalizedPath}`);

			// Check if file already exists
			try {
				await fs.promises.stat(fullPath);
				// File exists, generate unique name
				const { name: baseName, ext } = this.parseFileName(fileName);
				let counter = 1;
				let newFileName = fileName;
				let newFullPath = fullPath;

				while (true) {
					try {
						await fs.promises.stat(newFullPath);
						// Still exists, try next number
						newFileName = `${baseName} (${counter})${ext}`;
						newFullPath = `${DOCUMENTS_ROOT}${normalizedPath}/${newFileName}`;
						counter++;
					} catch {
						// File doesn't exist, we can use this name
						fileName = newFileName;
						fullPath = newFullPath;
						break;
					}
				}
			} catch {
				// File doesn't exist, we can use original name
			}

			// Read file as ArrayBuffer
			const arrayBuffer = await file.arrayBuffer();
			const uint8Array = new Uint8Array(arrayBuffer);

			// Double-check directory exists before writing (safety measure)
			const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
			logInfo(`📂 Final directory check before write: ${dirPath}`);
			await this.ensureDirectory(dirPath);
			logInfo(`✅ Directory verified, writing file: ${fullPath}`);

			// Write file to filesystem with retry logic (ZenFS can be finicky)
			let writeAttempts = 0;
			const maxWriteAttempts = 3;
			let lastWriteError: unknown = null;

			while (writeAttempts < maxWriteAttempts) {
				try {
					await fs.promises.writeFile(fullPath, uint8Array);
					logInfo(
						`✅ File written successfully: ${fullPath} (attempt ${writeAttempts + 1})`,
					);
					break; // Success!
				} catch (writeErr) {
					writeAttempts++;
					lastWriteError = writeErr;

					logError(
						`⚠️ Failed to write file ${fullPath} (attempt ${writeAttempts}/${maxWriteAttempts}):`,
						writeErr,
					);

					if (writeAttempts < maxWriteAttempts) {
						// Retry: ensure directory exists again before next attempt
						logInfo(`🔄 Retrying write after ensuring directory...`);
						await this.ensureDirectory(dirPath);
						// Small delay before retry
						await new Promise((resolve) => setTimeout(resolve, 100));
					} else {
						// Final attempt failed, provide diagnostics
						try {
							const dirStat = await fs.promises.stat(dirPath);
							logError(
								`Directory ${dirPath} status: exists=${dirStat.isDirectory()}, size=${dirStat.size}`,
							);
						} catch (dirStatErr) {
							logError(`Directory ${dirPath} stat failed:`, dirStatErr);
						}
						throw lastWriteError;
					}
				}
			}

			// Create file metadata (use path as ID for consistency)
			const filePath = `${normalizedPath}/${fileName}`;
			const docFile: DocumentFile = {
				id: filePath, // Use path as ID
				name: fileName,
				path: filePath,
				type: this.getDocumentType(file.type, fileName),
				mimeType: file.type,
				size: file.size,
				createdAt: new Date(),
				modifiedAt: new Date(),
				metadata: metadata || {},
			};

			logInfo(`📄 Uploaded file: ${docFile.path}`);

			// Notify other contexts about the filesystem change
			this.notifyFilesystemChanged({
				scope: "documents",
				operation: "create",
				path: docFile.path,
			});

			return docFile;
		} catch (error) {
			logError(`Failed to upload file ${fileName}:`, error);
			throw error;
		}
	}

	/**
	 * Upload an image from the chat input.
	 * Stores under /resources/images/ with a UUID filename to avoid collisions.
	 * Returns the relative path (e.g. /resources/images/<uuid>.png) suitable for
	 * storing in messages.complexContent and retrieving via readFileAsBase64().
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

		const targetDir = `${DOCUMENTS_ROOT}/resources/images`;
		await this.ensureDirectory(targetDir);

		const fullPath = `${targetDir}/${fileName}`;
		const arrayBuffer = await file.arrayBuffer();
		await fs.promises.writeFile(fullPath, new Uint8Array(arrayBuffer));

		logInfo(`🖼️ Uploaded chat image: ${fullPath}`);
		return `/resources/images/${fileName}`;
	}

	/**
	 * Read a file stored in the document filesystem and return it as a base64 data URI.
	 * @param path Relative path as stored in complexContent (e.g. /resources/images/<uuid>.png)
	 * @param mimeType MIME type for the data URI (e.g. "image/png")
	 */
	async readFileAsBase64(path: string, mimeType: string): Promise<string> {
		const bytes = await this.getFileContent(path);

		let binary = "";
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		const base64 = btoa(binary);
		return `data:${mimeType};base64,${base64}`;
	}

	/**
	 * Create a new folder
	 */
	async createFolder(
		name: string,
		parentPath: string = "/",
	): Promise<DocumentFolder> {
		await this.initialize();

		const normalizedParentPath = this.normalizePath(parentPath);
		const folderPath = `${normalizedParentPath}/${name}`;
		const fullPath = `${DOCUMENTS_ROOT}${folderPath}`;

		try {
			// Ensure parent directory exists BEFORE checking if folder exists
			await this.ensureDirectory(`${DOCUMENTS_ROOT}${normalizedParentPath}`);

			// Check if folder already exists
			try {
				await fs.promises.stat(fullPath);
				throw new Error(`Folder already exists: ${name}`);
			} catch (error) {
				// If it's not a "folder exists" error, check if it's just missing (which is what we want)
				if (
					error instanceof Error &&
					error.message.includes("already exists")
				) {
					throw error;
				}
				// Folder doesn't exist, we can create it
			}

			await this.ensureDirectory(fullPath);

			const folder: DocumentFolder = {
				id: folderPath, // Use path as ID
				name,
				path: folderPath,
				parentPath: normalizedParentPath === "/" ? null : normalizedParentPath,
				createdAt: new Date(),
				modifiedAt: new Date(),
				childCount: 0,
			};

			logInfo(`📁 Created folder: ${folder.path}`);

			// Notify other contexts about the filesystem change
			this.notifyFilesystemChanged({
				scope: "documents",
				operation: "mkdir",
				path: folder.path,
			});

			return folder;
		} catch (error) {
			logError(`Failed to create folder ${name}:`, error);
			throw error;
		}
	}

	/**
	 * Get file content by file ID (which is actually the file path)
	 */
	async getFileContent(fileId: string): Promise<Uint8Array> {
		// In the simple approach, we'll use the file path as ID
		// First try to use fileId as path directly
		let filePath = fileId;

		// If fileId doesn't start with /, it might be an old random ID
		// In that case, scan to find the file
		if (!fileId.startsWith("/")) {
			const files = await this.scanFiles();
			const file = files.find((f) => f.id === fileId);

			if (!file) {
				throw new Error(`File not found: ${fileId}`);
			}
			filePath = file.path;
		}

		const fullPath = `${DOCUMENTS_ROOT}${filePath}`;

		try {
			return await fs.promises.readFile(fullPath);
		} catch (error) {
			throw new Error(`File not found: ${fileId}`);
		}
	}

	/**
	 * Update file content by file ID
	 * Note: Does NOT trigger filesystem changed notification since
	 * content updates don't affect the tree structure
	 */
	async updateFileContent(fileId: string, content: Uint8Array): Promise<void> {
		// Get file path from ID
		let filePath = fileId;

		// If fileId doesn't start with /, it might be an old random ID
		// In that case, scan to find the file
		if (!fileId.startsWith("/")) {
			const files = await this.scanFiles();
			const file = files.find((f) => f.id === fileId);

			if (!file) {
				throw new Error(`File not found: ${fileId}`);
			}
			filePath = file.path;
		}

		const fullPath = `${DOCUMENTS_ROOT}${filePath}`;

		try {
			// Write the new content
			await fs.promises.writeFile(fullPath, content);

			// Do NOT notify filesystem changed for content updates
			// Content changes don't affect tree structure, so no reload needed
			// This prevents the editor from closing/resetting after save

			logInfo(`📝 Updated file content: ${filePath}`);
		} catch (error) {
			logError(`Failed to update file content: ${filePath}`, error);
			throw new Error(`Failed to update file: ${fileId}`);
		}
	}

	/**
	 * Ensure a logical document folder exists, e.g. "/skills".
	 */
	async ensureFolderPath(folderPath: string): Promise<void> {
		await this.initialize();
		const normalizedPath = this.normalizePath(
			folderPath.startsWith("/") ? folderPath : `/${folderPath}`,
		);
		await this.ensureDirectory(`${DOCUMENTS_ROOT}${normalizedPath}`);
	}

	/**
	 * Write raw bytes to a logical document path, creating parent folders as needed.
	 */
	async writeFileContent(filePath: string, content: Uint8Array): Promise<void> {
		await this.initialize();
		const normalizedPath = this.normalizePath(
			filePath.startsWith("/") ? filePath : `/${filePath}`,
		);
		if (normalizedPath === "/") {
			throw new Error("Cannot write document root");
		}

		const fullPath = `${DOCUMENTS_ROOT}${normalizedPath}`;
		const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));
		await this.ensureDirectory(dirPath);

		let operation: FilesystemChangeOperation = "create";
		try {
			await fs.promises.stat(fullPath);
			operation = "write";
		} catch (error) {
			if (!this.isNotFoundError(error)) throw error;
		}

		await fs.promises.writeFile(fullPath, content);
		logInfo(`📝 Wrote document file: ${normalizedPath}`);

		this.notifyFilesystemChanged({
			scope: "documents",
			operation,
			path: normalizedPath,
		});
	}

	/**
	 * Delete a file at a logical document path.
	 */
	async deleteFileContent(filePath: string): Promise<void> {
		await this.initialize();
		const normalizedPath = this.normalizePath(
			filePath.startsWith("/") ? filePath : `/${filePath}`,
		);
		if (normalizedPath === "/") {
			throw new Error("Cannot delete document root");
		}

		const fullPath = `${DOCUMENTS_ROOT}${normalizedPath}`;
		await fs.promises.unlink(fullPath);
		logInfo(`🗑️ Deleted document file: ${normalizedPath}`);

		this.notifyFilesystemChanged({
			scope: "documents",
			operation: "delete",
			path: normalizedPath,
		});
	}

	/**
	 * Get tree structure by scanning filesystem
	 * Uses internal cache to avoid re-scanning when data hasn't changed
	 * Cache is automatically invalidated when filesystem changes in ANY context
	 */
	async getTree(): Promise<DocumentTreeNode[]> {
		await this.initialize();
		// /home can be briefly unavailable while ZenFS cache is being refreshed
		// from another context; ensure root path exists before scanning.
		await this.ensureDirectory(DOCUMENTS_ROOT);

		// Return cached data if valid
		if (this.treeCacheValid && this.treeCache) {
			logInfo("📦 Returning cached tree data");
			return this.treeCache;
		}

		// Cache invalid or empty, fetch fresh data
		logInfo("🔄 Fetching fresh tree data");
		const freshTree = await this.scanDirectory(DOCUMENTS_ROOT, "/");

		// Update cache
		this.treeCache = freshTree;
		this.treeCacheValid = true;

		return freshTree;
	}

	/**
	 * Scan directory and build tree
	 */
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
						id: fullLogicalPath, // Use path as ID
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
						const detectedType = this.getDocumentType("", entry.name);
						const mimeType = this.getMimeTypeFromExtension(entry.name);

						const file: DocumentFile = {
							id: fullLogicalPath, // Use path as ID
							name: entry.name,
							path: fullLogicalPath,
							type: detectedType,
							mimeType: mimeType,
							size: stats.size,
							createdAt: new Date(stats.birthtime || stats.mtime),
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
						// File may disappear between readdir and stat due to concurrent writes.
						if (!this.isNotFoundError(error)) {
							logError(`Failed to stat file ${fullFsPath}:`, error);
						}
					}
				}
			}
		} catch (error) {
			// Directory may be transiently missing during cross-context FS refresh.
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

	/**
	 * Scan all files (helper for getFileContent)
	 */
	private async scanFiles(): Promise<DocumentFile[]> {
		const files: DocumentFile[] = [];
		const tree = await this.getTree();

		const collectFiles = (nodes: DocumentTreeNode[]) => {
			for (const node of nodes) {
				if (node.type === "file" && node.file) {
					files.push(node.file);
				}
				if (node.children) {
					collectFiles(node.children);
				}
			}
		};

		collectFiles(tree);
		return files;
	}

	/**
	 * Delete a file
	 */
	async deleteFile(fileId: string): Promise<void> {
		const files = await this.scanFiles();
		const file = files.find((f) => f.id === fileId);

		if (!file) {
			throw new Error(`File not found: ${fileId}`);
		}

		const fullPath = `${DOCUMENTS_ROOT}${file.path}`;
		await fs.promises.unlink(fullPath);
		logInfo(`🗑️ Deleted file: ${file.path}`);

		// Notify other contexts about the filesystem change
		this.notifyFilesystemChanged({
			scope: "documents",
			operation: "delete",
			path: file.path,
		});
	}

	/**
	 * Delete a folder
	 */
	async deleteFolder(folderId: string): Promise<void> {
		await this.initialize();
		const fullPath = `${DOCUMENTS_ROOT}${folderId}`;
		const stats = await fs.promises.stat(fullPath);
		if (!stats.isDirectory())
			throw new Error(`Path is not a folder: ${folderId}`);
		await this.deleteDirectoryRecursive(fullPath);
		logInfo(`Deleted folder recursively: ${folderId}`);
		this.notifyFilesystemChanged({
			scope: "documents",
			operation: "delete",
			path: folderId,
		});
	}

	/**
	 * Rename a file
	 */
	async renameFile(fileId: string, newName: string): Promise<DocumentFile> {
		await this.initialize();

		const files = await this.scanFiles();
		const file = files.find((f) => f.id === fileId);

		if (!file) {
			throw new Error(`File not found: ${fileId}`);
		}

		const oldFullPath = `${DOCUMENTS_ROOT}${file.path}`;
		const parentPath = file.path.substring(0, file.path.lastIndexOf("/"));
		const newPath = `${parentPath}/${newName}`;
		const newFullPath = `${DOCUMENTS_ROOT}${newPath}`;

		try {
			// Check if a file with the new name already exists
			try {
				await fs.promises.stat(newFullPath);
				throw new Error(`A file with the name "${newName}" already exists`);
			} catch (error) {
				// If it's not a "file exists" error, continue with rename
				if (
					error instanceof Error &&
					error.message.includes("already exists")
				) {
					throw error;
				}
			}

			// Rename the file
			await fs.promises.rename(oldFullPath, newFullPath);

			// Get new file stats
			const stats = await fs.promises.stat(newFullPath);
			const mimeType = this.getMimeTypeFromExtension(newName);

			const renamedFile: DocumentFile = {
				id: newPath,
				name: newName,
				path: newPath,
				type: this.getDocumentType(mimeType, newName),
				mimeType,
				size: stats.size,
				createdAt: new Date(stats.birthtime || stats.mtime),
				modifiedAt: new Date(stats.mtime),
				metadata: file.metadata || {},
			};

			logInfo(`📝 Renamed file: ${file.path} -> ${newPath}`);

			// Notify other contexts about the filesystem change
			this.notifyFilesystemChanged({
				scope: "documents",
				operation: "rename",
				oldPath: file.path,
				newPath,
			});

			return renamedFile;
		} catch (error) {
			logError(`Failed to rename file ${fileId}:`, error);
			throw error;
		}
	}

	/**
	 * Rename a folder
	 */
	async renameFolder(
		folderId: string,
		newName: string,
	): Promise<DocumentFolder> {
		await this.initialize();

		const oldFullPath = `${DOCUMENTS_ROOT}${folderId}`;
		const parentPath = folderId.substring(0, folderId.lastIndexOf("/")) || "/";
		const newPath =
			parentPath === "/" ? `/${newName}` : `${parentPath}/${newName}`;
		const newFullPath = `${DOCUMENTS_ROOT}${newPath}`;

		try {
			// Check if folder exists
			const stats = await fs.promises.stat(oldFullPath);
			if (!stats.isDirectory()) {
				throw new Error("Path is not a folder");
			}

			// Check if a folder with the new name already exists
			try {
				await fs.promises.stat(newFullPath);
				throw new Error(`A folder with the name "${newName}" already exists`);
			} catch (error) {
				// If it's not a "folder exists" error, continue with rename
				if (
					error instanceof Error &&
					error.message.includes("already exists")
				) {
					throw error;
				}
			}

			// Rename the folder
			await fs.promises.rename(oldFullPath, newFullPath);

			// Get new folder stats and count children
			const newStats = await fs.promises.stat(newFullPath);
			const entries = await fs.promises.readdir(newFullPath);

			const renamedFolder: DocumentFolder = {
				id: newPath,
				name: newName,
				path: newPath,
				parentPath: parentPath === "/" ? null : parentPath,
				createdAt: new Date(newStats.birthtime || newStats.mtime),
				modifiedAt: new Date(newStats.mtime),
				childCount: entries.length,
			};

			logInfo(`📁 Renamed folder: ${folderId} -> ${newPath}`);

			// Notify other contexts about the filesystem change
			this.notifyFilesystemChanged({
				scope: "documents",
				operation: "rename",
				oldPath: folderId,
				newPath,
			});

			return renamedFolder;
		} catch (error) {
			logError(`Failed to rename folder ${folderId}:`, error);
			throw error;
		}
	}

	/**
	 * Parse filename into name and extension
	 */
	private parseFileName(fileName: string): { name: string; ext: string } {
		const lastDotIndex = fileName.lastIndexOf(".");
		if (lastDotIndex === -1) {
			return { name: fileName, ext: "" };
		}
		return {
			name: fileName.substring(0, lastDotIndex),
			ext: fileName.substring(lastDotIndex),
		};
	}

	/**
	 * Get MIME type from file extension
	 */
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

		return mimeTypes[ext] || "application/octet-stream";
	}

	/**
	 * Normalize path
	 */
	private normalizePath(path: string): string {
		return path.replace(/\/+$/, "") || "/";
	}

	/**
	 * Build a read-only document mount snapshot for the sandbox runtime.
	 * Paths are projected from document logical paths ("/...") to "/documents/...".
	 */
	async getSandboxMountSnapshot(): Promise<SandboxDocumentsMountSnapshot> {
		await this.initialize();

		const directories = new Set<string>([SANDBOX_DOCUMENTS_ROOT]);
		const files = new Set<string>();
		const tree = await this.getTree();

		const toSandboxPath = (logicalPath: string): string | null => {
			if (!logicalPath.startsWith("/")) return null;
			const segments = logicalPath
				.replace(/\\/g, "/")
				.split("/")
				.filter(Boolean);

			// Block path traversal/special segments from being projected into sandbox.
			for (const segment of segments) {
				if (segment === "." || segment === ".." || segment.includes("\0")) {
					return null;
				}
			}

			if (segments.length === 0) return SANDBOX_DOCUMENTS_ROOT;
			return `${SANDBOX_DOCUMENTS_ROOT}/${segments.join("/")}`;
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
				const sandboxPath = toSandboxPath(node.path);
				if (!sandboxPath) continue;

				if (node.type === "folder") {
					directories.add(sandboxPath);
				} else if (node.type === "file") {
					files.add(sandboxPath);
					ensureParentDirectories(sandboxPath);
				}

				if (node.children?.length) {
					walk(node.children);
				}
			}
		};

		walk(tree);

		return {
			directories: Array.from(directories).sort(),
			files: Array.from(files).sort(),
		};
	}

	// ── Workspace ────────────────────────────────────────────────────────────

	/** Scan /home/workspace and return a DocumentTreeNode tree. */
	async getWorkspaceTree(): Promise<DocumentTreeNode[]> {
		await this.initialize();
		await this.ensureDirectory(WORKSPACE_ROOT);
		return this.scanDirectory(WORKSPACE_ROOT, "/");
	}

	/**
	 * Build a read-write workspace mount snapshot for the sandbox runtime.
	 * Paths are projected from /home/workspace/... to /workspaces/...
	 */
	async getSandboxWorkspaceMountSnapshot(): Promise<SandboxDocumentsMountSnapshot> {
		await this.initialize();
		await this.ensureDirectory(WORKSPACE_ROOT);

		const directories = new Set<string>([SANDBOX_WORKSPACE_ROOT]);
		const files = new Set<string>();
		const tree = await this.getWorkspaceTree();

		const toSandboxPath = (logicalPath: string): string | null => {
			if (!logicalPath.startsWith("/")) return null;
			const segments = logicalPath
				.replace(/\\/g, "/")
				.split("/")
				.filter(Boolean);
			for (const segment of segments) {
				if (segment === "." || segment === ".." || segment.includes("\0")) {
					return null;
				}
			}
			if (segments.length === 0) return SANDBOX_WORKSPACE_ROOT;
			return `${SANDBOX_WORKSPACE_ROOT}/${segments.join("/")}`;
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
				const sandboxPath = toSandboxPath(node.path);
				if (!sandboxPath) continue;
				if (node.type === "folder") {
					directories.add(sandboxPath);
				} else if (node.type === "file") {
					files.add(sandboxPath);
					ensureParentDirectories(sandboxPath);
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

	/** Convert a sandbox /workspaces/... path to the ZenFS absolute path. */
	private toWorkspaceFsPath(sandboxPath: string): string {
		const normalized = sandboxPath.replace(/\\/g, "/");
		const base =
			normalized === SANDBOX_WORKSPACE_LEGACY_ROOT ||
			normalized.startsWith(`${SANDBOX_WORKSPACE_LEGACY_ROOT}/`)
				? SANDBOX_WORKSPACE_LEGACY_ROOT
				: SANDBOX_WORKSPACE_ROOT;
		const logical = normalized === base ? "" : normalized.slice(base.length);
		return `${WORKSPACE_ROOT}${logical}`;
	}

	/** Read raw bytes from a workspace file (sandboxPath = /workspaces/...). */
	async getWorkspaceFileContent(sandboxPath: string): Promise<Uint8Array> {
		const fsPath = this.toWorkspaceFsPath(sandboxPath);
		try {
			return await fs.promises.readFile(fsPath);
		} catch {
			throw new Error(`Workspace file not found: ${sandboxPath}`);
		}
	}

	/** Write UTF-8 content to a workspace file, persisting to IndexedDB. */
	async writeWorkspaceFile(
		sandboxPath: string,
		content: string,
	): Promise<void> {
		const fsPath = this.toWorkspaceFsPath(sandboxPath);
		const dirPath = fsPath.substring(0, fsPath.lastIndexOf("/"));
		await this.ensureDirectory(dirPath);
		try {
			await fs.promises.writeFile(fsPath, content, {
				encoding: "utf8",
				flag: "w",
			});
		} catch (error) {
			if (!this.isNotFoundError(error)) throw error;

			// IndexedDB-backed ZenFS can briefly miss a newly-created parent in
			// another context. Re-check the directory path and retry once.
			await this.ensureDirectory(dirPath);
			await fs.promises.writeFile(fsPath, content, {
				encoding: "utf8",
				flag: "w",
			});
		}
		this.notifyFilesystemChanged({
			scope: "workspace",
			operation: "write",
			path: sandboxPath,
		});
	}

	/** Create a workspace directory. */
	async mkdirWorkspace(sandboxPath: string): Promise<void> {
		const fsPath = this.toWorkspaceFsPath(sandboxPath);
		await this.ensureDirectory(fsPath);
		this.notifyFilesystemChanged({
			scope: "workspace",
			operation: "mkdir",
			path: sandboxPath,
		});
	}

	/** Delete a workspace file. */
	async deleteWorkspaceFile(sandboxPath: string): Promise<void> {
		const fsPath = this.toWorkspaceFsPath(sandboxPath);
		await fs.promises.unlink(fsPath);
		this.notifyFilesystemChanged({
			scope: "workspace",
			operation: "delete",
			path: sandboxPath,
		});
	}

	/** Recursively delete a workspace folder. */
	async deleteWorkspaceFolder(sandboxPath: string): Promise<void> {
		const fsPath = this.toWorkspaceFsPath(sandboxPath);
		const stats = await fs.promises.stat(fsPath);
		if (!stats.isDirectory())
			throw new Error(`Not a directory: ${sandboxPath}`);
		await this.deleteDirectoryRecursive(fsPath);
		this.notifyFilesystemChanged({
			scope: "workspace",
			operation: "delete",
			path: sandboxPath,
		});
	}

	/**
	 * Rename a workspace file.
	 * @returns The new sandbox path (/workspaces/...).
	 */
	async renameWorkspaceFile(
		sandboxPath: string,
		newName: string,
	): Promise<string> {
		const oldFsPath = this.toWorkspaceFsPath(sandboxPath);
		const parentFsPath = oldFsPath.substring(0, oldFsPath.lastIndexOf("/"));
		const newFsPath = `${parentFsPath}/${newName}`;
		await fs.promises.rename(oldFsPath, newFsPath);
		const parentSandbox = sandboxPath.substring(
			0,
			sandboxPath.lastIndexOf("/"),
		);
		const newSandboxPath = `${parentSandbox}/${newName}`;
		this.notifyFilesystemChanged({
			scope: "workspace",
			operation: "rename",
			oldPath: sandboxPath,
			newPath: newSandboxPath,
		});
		return newSandboxPath;
	}

	// ── End Workspace ─────────────────────────────────────────────────────────

	/**
	 * Move a file to a new location
	 */
	async moveFile(
		fileId: string,
		targetFolderPath: string,
	): Promise<DocumentFile> {
		await this.initialize();

		const normalizedTargetPath = this.normalizePath(targetFolderPath);
		const filePath = `${DOCUMENTS_ROOT}${fileId}`;

		try {
			// Get file stats to ensure it exists and is a file
			const stats = await fs.promises.stat(filePath);
			if (!stats.isFile()) {
				throw new Error("Path is not a file");
			}

			// Get file name from path
			const fileName = filePath.split("/").pop() || "";
			let newFilePath = `${DOCUMENTS_ROOT}${normalizedTargetPath}/${fileName}`;

			// Check if file already exists at destination
			try {
				await fs.promises.stat(newFilePath);
				// File exists, generate unique name
				const { name: baseName, ext } = this.parseFileName(fileName);
				let counter = 1;
				let newFileName = fileName;

				while (true) {
					try {
						await fs.promises.stat(newFilePath);
						// Still exists, try next number
						newFileName = `${baseName} (${counter})${ext}`;
						newFilePath = `${DOCUMENTS_ROOT}${normalizedTargetPath}/${newFileName}`;
						counter++;
					} catch {
						// File doesn't exist, we can use this name
						break;
					}
				}
			} catch {
				// File doesn't exist at destination, we can use original name
			}

			// Ensure target directory exists
			await this.ensureDirectory(`${DOCUMENTS_ROOT}${normalizedTargetPath}`);

			// Read file content
			const content = await fs.promises.readFile(filePath);

			// Write to new location
			await fs.promises.writeFile(newFilePath, content);

			// Delete old file
			await fs.promises.unlink(filePath);

			// Get new file stats
			const newStats = await fs.promises.stat(newFilePath);
			const newFileName = newFilePath.split("/").pop() || "";
			const newId = newFilePath.replace(DOCUMENTS_ROOT, "");

			// Detect MIME type from file extension
			const mimeType = this.getMimeTypeFromExtension(newFileName);

			logInfo(`✅ Moved file from ${fileId} to ${newId}`);

			// Notify other contexts about the filesystem change
			this.notifyFilesystemChanged({
				scope: "documents",
				operation: "move",
				oldPath: fileId,
				newPath: newId,
			});

			return {
				id: newId,
				name: newFileName,
				type: this.getDocumentType(mimeType, newFileName),
				path: newId,
				size: newStats.size,
				mimeType,
				createdAt: newStats.birthtime,
				modifiedAt: newStats.mtime,
			};
		} catch (error) {
			logError(`Failed to move file ${fileId}:`, error);
			throw error;
		}
	}

	/**
	 * Move a folder to a new location
	 */
	async moveFolder(
		folderId: string,
		targetFolderPath: string,
	): Promise<DocumentFolder> {
		await this.initialize();

		const normalizedTargetPath = this.normalizePath(targetFolderPath);
		const folderPath = `${DOCUMENTS_ROOT}${folderId}`;
		const targetFullPath = `${DOCUMENTS_ROOT}${normalizedTargetPath}`;

		try {
			// Validate source folder exists and is a directory
			const stats = await fs.promises.stat(folderPath);
			if (!stats.isDirectory()) {
				throw new Error("Path is not a folder");
			}

			// Prevent moving a folder into itself or its subdirectories
			if (targetFullPath.startsWith(folderPath)) {
				throw new Error(
					"Cannot move a folder into itself or its subdirectories",
				);
			}

			// Get folder name from path
			const folderName = folderPath.split("/").filter(Boolean).pop() || "";
			let newFolderPath = `${targetFullPath}/${folderName}`;

			// Check if folder already exists at destination
			try {
				await fs.promises.stat(newFolderPath);
				// Folder exists, generate unique name
				let counter = 1;
				let newFolderName = folderName;

				while (true) {
					try {
						await fs.promises.stat(newFolderPath);
						// Still exists, try next number
						newFolderName = `${folderName} (${counter})`;
						newFolderPath = `${targetFullPath}/${newFolderName}`;
						counter++;
					} catch {
						// Folder doesn't exist, we can use this name
						break;
					}
				}
			} catch {
				// Folder doesn't exist at destination
			}

			// Ensure target directory exists
			await this.ensureDirectory(targetFullPath);

			// Recursively copy folder
			await this.copyDirectory(folderPath, newFolderPath);

			// Delete old folder
			await this.deleteDirectoryRecursive(folderPath);

			// Get new folder stats
			const newStats = await fs.promises.stat(newFolderPath);
			const newFolderName =
				newFolderPath.split("/").filter(Boolean).pop() || "";
			const newId = newFolderPath.replace(DOCUMENTS_ROOT, "");

			// Count children
			const entries = await fs.promises.readdir(newFolderPath);

			logInfo(`✅ Moved folder from ${folderId} to ${newId}`);

			// Notify other contexts about the filesystem change
			this.notifyFilesystemChanged({
				scope: "documents",
				operation: "move",
				oldPath: folderId,
				newPath: newId,
			});

			return {
				id: newId,
				name: newFolderName,
				path: newId,
				parentPath: normalizedTargetPath === "/" ? null : normalizedTargetPath,
				childCount: entries.length,
				createdAt: newStats.birthtime,
				modifiedAt: newStats.mtime,
			};
		} catch (error) {
			logError(`Failed to move folder ${folderId}:`, error);
			throw error;
		}
	}

	/**
	 * Recursively copy a directory
	 */
	private async copyDirectory(
		source: string,
		destination: string,
	): Promise<void> {
		await fs.promises.mkdir(destination, { recursive: true });
		const entries = await fs.promises.readdir(source, { withFileTypes: true });

		for (const entry of entries) {
			const sourcePath = `${source}/${entry.name}`;
			const destPath = `${destination}/${entry.name}`;

			if (entry.isDirectory()) {
				await this.copyDirectory(sourcePath, destPath);
			} else {
				const content = await fs.promises.readFile(sourcePath);
				await fs.promises.writeFile(destPath, content);
			}
		}
	}

	/**
	 * Recursively delete a directory
	 */
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
}

export const documentFileSystemService = DocumentFileSystem.getInstance();
