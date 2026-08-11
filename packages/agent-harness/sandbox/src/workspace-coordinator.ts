import type { HarnessFileSystem } from "@memorall/agent-harness-standard/filesystem";
import type {
	SandboxCallContext,
	SandboxProviderSession,
	SandboxWorkspaceChange,
	SandboxWorkspaceConflict,
	SandboxWorkspaceFile,
	SandboxWorkspaceManifest,
	SandboxWorkspaceSyncResult,
} from "./contracts.js";

export interface SandboxWorkspaceBinding {
	workspaceId?: string;
	root: string;
	revisions: ReadonlyMap<string, string | undefined>;
	directories: ReadonlySet<string>;
	files: ReadonlyMap<string, SandboxWorkspaceFile>;
}

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

const uniqueConflicts = (
	conflicts: readonly SandboxWorkspaceConflict[],
): SandboxWorkspaceConflict[] => {
	const byPath = new Map<string, SandboxWorkspaceConflict>();
	for (const conflict of conflicts) byPath.set(conflict.path, conflict);
	return [...byPath.values()];
};

const normalizeRoot = (root: string): string => {
	const normalized = `/${root}`.replace(/\\/g, "/").replace(/\/+/g, "/");
	return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
};

const joinPath = (parent: string, child: string): string =>
	parent === "/" ? `/${child}` : `${parent}/${child}`;

const hashBytes = (bytes: Uint8Array): string => {
	let hash = 0x811c9dc5;
	for (const byte of bytes) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}
	return `${bytes.byteLength}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const revisionForContent = (content: string): string =>
	hashBytes(new TextEncoder().encode(content));

/** Harness-owned workspace lifecycle; providers only implement transport. */
export class SandboxWorkspaceCoordinator {
	private readonly bindings = new Map<string, SandboxWorkspaceBinding>();

	constructor(
		private fileSystem?: HarnessFileSystem,
		private readonly defaultRoot = "/",
	) {}

	setFileSystem(fileSystem: HarnessFileSystem): void {
		this.fileSystem = fileSystem;
	}

	private async readRevision(path: string): Promise<string | undefined> {
		if (!this.fileSystem) return undefined;
		try {
			return hashBytes(await this.fileSystem.readFile(path));
		} catch {
			return undefined;
		}
	}

	private async capture(root = this.defaultRoot): Promise<SandboxWorkspaceManifest> {
		const normalizedRoot = normalizeRoot(root);
		const directories: string[] = [normalizedRoot];
		const files: SandboxWorkspaceFile[] = [];
		if (!this.fileSystem) {
			return { root: normalizedRoot, directories, files, mode: "full" };
		}

		const visit = async (directory: string): Promise<void> => {
			let entries;
			try {
				entries = await this.fileSystem!.readdir(directory, {
					withFileTypes: true,
				});
			} catch {
				return;
			}
			for (const entry of entries) {
				const path = joinPath(directory, entry.name);
				if (entry.isDirectory()) {
					directories.push(path);
					await visit(path);
				} else if (entry.isFile()) {
					const bytes = await this.fileSystem!.readFile(path);
					files.push({
						path,
						content: new TextDecoder().decode(bytes),
						revision: hashBytes(bytes),
					});
				}
			}
		};

		await visit(normalizedRoot);
		return { root: normalizedRoot, directories, files, mode: "full" };
	}

	private setBinding(
		sessionId: string,
		manifest: SandboxWorkspaceManifest,
	): SandboxWorkspaceBinding {
		const binding: SandboxWorkspaceBinding = {
			workspaceId: manifest.workspaceId,
			root: manifest.root,
			revisions: new Map(
				manifest.files.map((file) => [file.path, file.revision]),
			),
			directories: new Set(manifest.directories),
			files: new Map(manifest.files.map((file) => [file.path, file])),
		};
		this.bindings.set(sessionId, binding);
		return binding;
	}

	async bind(
		session: SandboxProviderSession,
		manifest: SandboxWorkspaceManifest | undefined,
		context: SandboxCallContext,
	): Promise<SandboxWorkspaceSyncResult> {
		const effectiveManifest = manifest ??
			(this.fileSystem ? await this.capture(this.defaultRoot) : undefined);
		const result = await session.workspace.bind(effectiveManifest, context);
		if (effectiveManifest) {
			this.setBinding(session.descriptor.sessionId, effectiveManifest);
		}
		return {
			...result,
			changedPaths: unique(result.changedPaths),
			conflicts: uniqueConflicts(result.conflicts),
		};
	}

	async sync(
		session: SandboxProviderSession,
		context: SandboxCallContext,
	): Promise<SandboxWorkspaceSyncResult> {
		if (!this.fileSystem) return { changedPaths: [], conflicts: [] };
		const binding = this.bindings.get(session.descriptor.sessionId);
		if (!binding) return this.bind(session, undefined, context);

		const current = await this.capture(binding.root);
		const currentFiles = new Map(current.files.map((file) => [file.path, file]));
		const changedFiles = current.files.filter(
			(file) => binding.revisions.get(file.path) !== file.revision,
		);
		const deletedPaths = [...binding.revisions.keys()].filter(
			(path) => !currentFiles.has(path),
		);
		const directories = current.directories.filter(
			(path) => !binding.directories.has(path),
		);

		if (changedFiles.length === 0 && deletedPaths.length === 0 && directories.length === 0) {
			return { changedPaths: [], conflicts: [] };
		}

		const delta: SandboxWorkspaceManifest = {
			workspaceId: binding.workspaceId,
			root: binding.root,
			directories,
			files: changedFiles,
			deletedPaths,
			mode: "incremental",
		};
		const result = await session.workspace.bind(delta, context);
		this.setBinding(session.descriptor.sessionId, current);
		return {
			...result,
			changedPaths: unique([
				...result.changedPaths,
				...changedFiles.map((file) => file.path),
				...deletedPaths,
				...directories,
			]),
			conflicts: uniqueConflicts(result.conflicts),
		};
	}

	async rebind(
		session: SandboxProviderSession,
		context: SandboxCallContext,
	): Promise<SandboxWorkspaceSyncResult> {
		const binding = this.bindings.get(session.descriptor.sessionId);
		if (!binding) return this.bind(session, undefined, context);
		const manifest = this.fileSystem
			? await this.capture(binding.root)
			: {
					workspaceId: binding.workspaceId,
					root: binding.root,
					directories: [...binding.directories],
					files: [...binding.files.values()],
					mode: "full" as const,
				};
		return this.bind(session, manifest, context);
	}

	private async applyChanges(
		binding: SandboxWorkspaceBinding | undefined,
		changes: readonly SandboxWorkspaceChange[],
	): Promise<{ changedPaths: string[]; conflicts: SandboxWorkspaceConflict[] }> {
		if (!this.fileSystem || !binding || changes.length === 0) {
			return { changedPaths: [], conflicts: [] };
		}
		const changedPaths: string[] = [];
		const conflicts: SandboxWorkspaceConflict[] = [];

		const hasConflict = async (path: string, incomingRevision?: string) => {
			const expectedRevision = binding.revisions.get(path);
			const actualRevision = await this.readRevision(path);
			if (
				actualRevision !== expectedRevision &&
				actualRevision !== incomingRevision
			) {
				conflicts.push({ path, expectedRevision, actualRevision });
				return true;
			}
			return false;
		};

		for (const change of changes) {
			if (change.operation === "mkdir") {
				await this.fileSystem.mkdir(change.path, { recursive: true });
				changedPaths.push(change.path);
				continue;
			}
			if (change.operation === "write") {
				if (await hasConflict(change.path, revisionForContent(change.content))) continue;
				await this.fileSystem.writeFile(change.path, change.content);
				changedPaths.push(change.path);
				continue;
			}
			if (change.operation === "delete") {
				if (await hasConflict(change.path)) continue;
				await this.fileSystem.rm(change.path, { recursive: true, force: true });
				changedPaths.push(change.path);
				continue;
			}
			if (await hasConflict(change.oldPath)) continue;
			if (await hasConflict(change.newPath)) continue;
			await this.fileSystem.rename(change.oldPath, change.newPath);
			changedPaths.push(change.oldPath, change.newPath);
		}
		return { changedPaths, conflicts };
	}

	async flush(
		session: SandboxProviderSession,
		context: SandboxCallContext,
	): Promise<SandboxWorkspaceSyncResult> {
		const result = await session.workspace.flush(context);
		const binding = this.bindings.get(session.descriptor.sessionId);
		const applied = await this.applyChanges(binding, result.changes ?? []);
		const conflicts = uniqueConflicts([...result.conflicts, ...applied.conflicts]);

		if (this.fileSystem && binding) {
			const current = await this.capture(binding.root);
			const conflictPaths = new Set(conflicts.map((conflict) => conflict.path));
			const revisions = new Map(binding.revisions);
			const files = new Map(binding.files);
			const currentPaths = new Set(current.files.map((file) => file.path));
			for (const file of current.files) {
				if (conflictPaths.has(file.path)) continue;
				revisions.set(file.path, file.revision);
				files.set(file.path, file);
			}
			for (const path of [...revisions.keys()]) {
				if (!currentPaths.has(path) && !conflictPaths.has(path)) {
					revisions.delete(path);
					files.delete(path);
				}
			}
			this.bindings.set(session.descriptor.sessionId, {
				...binding,
				revisions,
				files,
				directories: new Set(current.directories),
			});
		}

		return {
			...result,
			changedPaths: unique([...result.changedPaths, ...applied.changedPaths]),
			conflicts,
		};
	}

	getBinding(sessionId: string): SandboxWorkspaceBinding | undefined {
		return this.bindings.get(sessionId);
	}

	release(sessionId: string): void {
		this.bindings.delete(sessionId);
	}
}
