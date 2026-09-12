import type {
	NativeFilesystemEntry,
	NativeFilesystemPort,
} from "@/platform/contracts/core";

export interface NativeFolderOptions {
	port: NativeFilesystemPort;
	rootId: string;
	/**
	 * How long a listing's metadata may be reused, in milliseconds.
	 *
	 * `readdir` fetches every child's metadata in one native call and seeds this
	 * cache with it. Without that, listing a folder costs one round trip for the
	 * listing plus one per file — ZenFS stats each entry, and
	 * `DocumentFileSystem.scanDirectory` stats it again — so a 500-file folder
	 * became a thousand IPC calls. Short enough that an edit made outside
	 * Memorall shows up promptly.
	 */
	cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 1_500;

/**
 * POSIX errno numbers for the failures the native side reports. The virtual
 * filesystem and its callers branch on `code` — `DocumentFileSystem.isNotFoundError`
 * checks for `ENOENT` — so a mapped folder has to fail the same way the
 * IndexedDB-backed one does or the tree silently misbehaves.
 */
const ERRNO: Record<string, number> = {
	NOT_FOUND: 2,
	IO: 5,
	PERMISSION: 13,
	READ_ONLY: 13,
	OUT_OF_SCOPE: 13,
	UNKNOWN_ROOT: 13,
	EXISTS: 17,
	NOT_DIR: 20,
	IS_DIR: 21,
	TOO_LARGE: 27,
	NOT_EMPTY: 39,
};

/**
 * Build the backend.
 *
 * The class is defined inside this function rather than at module scope on
 * purpose. Several suites glob-import every module under `src/services` with
 * `@zenfs/core` mocked down to a handful of members; a top-level
 * `class X extends FileSystem` would evaluate against that mock and throw at
 * import time. Deferring the import keeps this module free of side effects.
 */
/**
 * The backend, plus a hook for the folder watcher.
 *
 * `invalidatePaths` forgets cached metadata for paths that changed outside
 * Memorall. An empty list means "something changed, but too much to enumerate"
 * and drops everything.
 */
export type NativeFolderFileSystem = import("@zenfs/core").FileSystem & {
	invalidatePaths(paths: string[]): void;
};

export async function createNativeFolderFileSystem(
	options: NativeFolderOptions,
): Promise<NativeFolderFileSystem> {
	const { FileSystem, ErrnoError } = await import("@zenfs/core");
	const { port, rootId } = options;
	const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

	const fail = (error: unknown, path: string): never => {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code: unknown }).code)
				: "IO";
		const message = error instanceof Error ? error.message : String(error);
		const failure = new ErrnoError(ERRNO[code] ?? 5, message);
		failure.path = path;
		throw failure;
	};

	/** ZenFS hands us mount-relative absolute paths; the port wants relative. */
	const relative = (path: string): string =>
		path.replace(/^\/+/, "").replace(/\/+$/, "");

	// Inode numbers must be stable for a path but must change when the file
	// does, or ZenFS's vnode cache can keep serving a stale size after an edit
	// made outside Memorall.
	const inodes = new Map<string, number>();
	let nextInode = 1;
	const inodeFor = (path: string, entry: NativeFilesystemEntry): number => {
		const key = `${path}:${entry.mtimeMs}:${entry.size}`;
		const existing = inodes.get(key);
		if (existing !== undefined) return existing;
		const assigned = nextInode++;
		inodes.set(key, assigned);
		if (inodes.size > 4096) {
			const oldest = inodes.keys().next().value;
			if (oldest !== undefined) inodes.delete(oldest);
		}
		return assigned;
	};

	const toInode = (path: string, entry: NativeFilesystemEntry) => {
		const mode =
			entry.kind === "directory"
				? 0o040755
				: entry.readOnly
					? 0o100444
					: 0o100644;
		const inode = inodeFor(path, entry);
		return {
			ino: inode,
			size: entry.kind === "directory" ? 4096 : entry.size,
			mode,
			nlink: 1,
			uid: 0,
			gid: 0,
			atimeMs: entry.mtimeMs,
			mtimeMs: entry.mtimeMs,
			ctimeMs: entry.mtimeMs,
			birthtimeMs: entry.birthtimeMs || entry.mtimeMs,
		};
	};

	const cache = new Map<string, { entry: NativeFilesystemEntry; at: number }>();
	const cacheGet = (path: string): NativeFilesystemEntry | null => {
		const hit = cache.get(path);
		if (!hit) return null;
		// >= so that a ttl of 0 means "never reuse" rather than "reuse within the
		// same millisecond".
		if (Date.now() - hit.at >= ttl) {
			cache.delete(path);
			return null;
		}
		return hit.entry;
	};
	const cacheSet = (path: string, entry: NativeFilesystemEntry): void => {
		cache.set(path, { entry, at: Date.now() });
	};
	const invalidate = (path: string): void => {
		cache.delete(path);
		const parent = path.slice(0, path.lastIndexOf("/")) || "/";
		cache.delete(parent);
	};

	const notSupported = (operation: string): never => {
		// Every filesystem consumer in this repo uses `fs.promises`, so nothing
		// should reach here. Throwing beats a silently wrong synchronous answer.
		throw new ErrnoError(
			95,
			`${operation} is not available on a mapped folder; use the async API.`,
		);
	};

	class NativeFolderFS extends FileSystem {
		constructor() {
			super(0x6e61746d, "NativeFolder");
		}

		async ready(): Promise<void> {}

		invalidatePaths(paths: string[]): void {
			if (paths.length === 0) {
				cache.clear();
				return;
			}
			for (const path of paths) {
				invalidate(path.startsWith("/") ? path : `/${path}`);
			}
		}

		async stat(path: string) {
			const cached = cacheGet(path);
			if (cached) return toInode(path, cached);
			try {
				const entry = await port.stat(rootId, relative(path));
				cacheSet(path, entry);
				return toInode(path, entry);
			} catch (error) {
				return fail(error, path);
			}
		}

		async readdir(path: string): Promise<string[]> {
			try {
				const entries = await port.list(rootId, relative(path));
				const base = path.endsWith("/") ? path : `${path}/`;
				for (const entry of entries) cacheSet(`${base}${entry.name}`, entry);
				return entries.map((entry) => entry.name);
			} catch (error) {
				return fail(error, path);
			}
		}

		async createFile(path: string) {
			try {
				const entry = await port.createFile(rootId, relative(path));
				invalidate(path);
				cacheSet(path, entry);
				return toInode(path, entry);
			} catch (error) {
				return fail(error, path);
			}
		}

		async mkdir(path: string) {
			try {
				const entry = await port.mkdir(rootId, relative(path));
				invalidate(path);
				cacheSet(path, entry);
				return toInode(path, entry);
			} catch (error) {
				return fail(error, path);
			}
		}

		async unlink(path: string): Promise<void> {
			try {
				await port.unlink(rootId, relative(path));
				invalidate(path);
			} catch (error) {
				fail(error, path);
			}
		}

		async rmdir(path: string): Promise<void> {
			try {
				await port.rmdir(rootId, relative(path));
				invalidate(path);
			} catch (error) {
				fail(error, path);
			}
		}

		async rename(oldPath: string, newPath: string): Promise<void> {
			try {
				await port.rename(rootId, relative(oldPath), relative(newPath));
				invalidate(oldPath);
				invalidate(newPath);
			} catch (error) {
				fail(error, oldPath);
			}
		}

		async touch(path: string, metadata: { mtimeMs?: number }): Promise<void> {
			try {
				await port.touch(
					rootId,
					relative(path),
					metadata.mtimeMs ?? Date.now(),
				);
				invalidate(path);
			} catch (error) {
				fail(error, path);
			}
		}

		async read(
			path: string,
			buffer: Uint8Array,
			start: number,
			end: number,
		): Promise<void> {
			try {
				const bytes = await port.read(rootId, relative(path), start, end);
				buffer.set(bytes.subarray(0, buffer.byteLength));
			} catch (error) {
				fail(error, path);
			}
		}

		async write(
			path: string,
			buffer: Uint8Array,
			offset: number,
		): Promise<void> {
			try {
				// Not truncating: ZenFS writes a region, and the file's final length
				// is whatever the higher layer has already arranged.
				await port.write(rootId, relative(path), offset, buffer, false);
				invalidate(path);
			} catch (error) {
				fail(error, path);
			}
		}

		async link(): Promise<void> {
			throw new ErrnoError(
				95,
				"Hard links are not supported in a mapped folder.",
			);
		}

		async sync(): Promise<void> {}

		// Unmounting calls this, so it must not throw or a folder cannot be
		// unmapped. Everything is already written through.
		syncSync(): void {}

		statSync(): never {
			return notSupported("statSync");
		}
		readdirSync(): never {
			return notSupported("readdirSync");
		}
		createFileSync(): never {
			return notSupported("createFileSync");
		}
		mkdirSync(): never {
			return notSupported("mkdirSync");
		}
		unlinkSync(): never {
			return notSupported("unlinkSync");
		}
		rmdirSync(): never {
			return notSupported("rmdirSync");
		}
		renameSync(): never {
			return notSupported("renameSync");
		}
		touchSync(): never {
			return notSupported("touchSync");
		}
		readSync(): never {
			return notSupported("readSync");
		}
		writeSync(): never {
			return notSupported("writeSync");
		}
		linkSync(): never {
			return notSupported("linkSync");
		}
	}

	return new NativeFolderFS() as unknown as NativeFolderFileSystem;
}
