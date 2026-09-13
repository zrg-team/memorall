import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type {
	NativeFilesystemEntry,
	NativeFolderChange,
	NativeFilesystemErrorCode,
	NativeFilesystemPort,
	NativeMountRoot,
} from "../contracts/core";
import type { MutableCapabilityRegistry } from "../core/capability-registry";

type Invoke = (
	command: string,
	args?: Record<string, unknown>,
) => Promise<unknown>;

type Listen = (
	event: string,
	handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

/** Must match FS_MAP_CHANGED_EVENT in `apps/desktop/src-tauri/src/fs_map.rs`. */
const FS_MAP_CHANGED_EVENT = "fs-map://changed";

/**
 * A failure that came back from the native side, carrying the code the virtual
 * filesystem maps onto an errno. Thrown as a plain `Error` with a `code` so it
 * crosses the platform contract without the contract needing a class.
 */
export interface NativeFilesystemError extends Error {
	code: NativeFilesystemErrorCode;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const nativeError = (error: unknown): NativeFilesystemError => {
	const code =
		isRecord(error) && typeof error.code === "string"
			? (error.code as NativeFilesystemErrorCode)
			: "IO";
	const message =
		isRecord(error) && typeof error.message === "string"
			? error.message
			: error instanceof Error
				? error.message
				: String(error);
	return Object.assign(new Error(message), { code });
};

/**
 * Writes cross the bridge base64-encoded.
 *
 * Tauri's IPC is JSON, so handing it a byte array spends about ten characters
 * per byte — saving an image into a mapped folder would push tens of megabytes
 * through the bridge. Base64 costs a third extra instead. Chunked because
 * `String.fromCharCode(...bytes)` overflows the argument limit on large files.
 */
const toBase64 = (data: Uint8Array): string => {
	let binary = "";
	const chunk = 0x8000;
	for (let offset = 0; offset < data.length; offset += chunk) {
		binary += String.fromCharCode(
			...data.subarray(offset, Math.min(offset + chunk, data.length)),
		);
	}
	return btoa(binary);
};

const toEntry = (value: unknown): NativeFilesystemEntry => {
	const record = isRecord(value) ? value : {};
	return {
		name: typeof record.name === "string" ? record.name : "",
		kind: record.kind === "directory" ? "directory" : "file",
		size: typeof record.size === "number" ? record.size : 0,
		mtimeMs: typeof record.mtimeMs === "number" ? record.mtimeMs : 0,
		birthtimeMs:
			typeof record.birthtimeMs === "number" ? record.birthtimeMs : 0,
		readOnly: record.readOnly === true,
	};
};

const toRoot = (value: unknown): NativeMountRoot => {
	const record = isRecord(value) ? value : {};
	return {
		id: typeof record.id === "string" ? record.id : "",
		label: typeof record.label === "string" ? record.label : "",
		displayPath:
			typeof record.displayPath === "string" ? record.displayPath : "",
		readOnly: record.readOnly === true,
		available: record.available !== false,
	};
};

/**
 * Talks to the scoped filesystem commands in `apps/desktop/src-tauri/src/fs_map.rs`.
 *
 * Note what this class cannot express: there is no method that takes an absolute
 * path. Roots come back from {@link addRoot}, which opens the OS folder picker,
 * and everything else is addressed relative to one. That is the security model,
 * and it lives in the shape of the API rather than in a validation step that can
 * be forgotten.
 */
export class DesktopNativeFilesystemPort implements NativeFilesystemPort {
	constructor(
		private readonly capabilities: MutableCapabilityRegistry,
		private readonly invoke: Invoke = (command, args) =>
			tauriInvoke(command, args),
		private readonly listen: Listen = (event, handler) =>
			tauriListen(event, handler),
	) {}

	private async call<T>(
		command: string,
		args?: Record<string, unknown>,
	): Promise<T> {
		try {
			return (await this.invoke(command, args)) as T;
		} catch (error) {
			throw nativeError(error);
		}
	}

	async listRoots(): Promise<NativeMountRoot[]> {
		try {
			const roots = await this.call<unknown[]>("fs_map_list_roots");
			const mapped = Array.isArray(roots) ? roots.map(toRoot) : [];
			this.capabilities.set("filesystem.native", { available: true });
			return mapped;
		} catch (error) {
			// The commands are missing or the supervisor is wedged: say so rather
			// than letting the library offer a picker that cannot open.
			this.capabilities.set("filesystem.native", {
				available: false,
				reason: (error as Error).message,
			});
			throw error;
		}
	}

	async addRoot(): Promise<NativeMountRoot | null> {
		const root = await this.call<unknown>("fs_map_add_root");
		return root === null || root === undefined ? null : toRoot(root);
	}

	removeRoot(rootId: string): Promise<void> {
		return this.call<void>("fs_map_remove_root", { rootId });
	}

	async list(rootId: string, path: string): Promise<NativeFilesystemEntry[]> {
		const entries = await this.call<unknown[]>("fs_map_list", {
			rootId,
			path,
		});
		return Array.isArray(entries) ? entries.map(toEntry) : [];
	}

	async stat(rootId: string, path: string): Promise<NativeFilesystemEntry> {
		return toEntry(await this.call<unknown>("fs_map_stat", { rootId, path }));
	}

	async read(
		rootId: string,
		path: string,
		start: number,
		end: number,
	): Promise<Uint8Array> {
		// The command answers with raw bytes, so this side never pays the JSON
		// cost on the read path.
		const bytes = await this.call<ArrayBuffer | Uint8Array | number[]>(
			"fs_map_read",
			{ rootId, path, start, end },
		);
		if (bytes instanceof Uint8Array) return bytes;
		if (Array.isArray(bytes)) return Uint8Array.from(bytes);
		return new Uint8Array(bytes);
	}

	write(
		rootId: string,
		path: string,
		offset: number,
		data: Uint8Array,
		truncate: boolean,
	): Promise<void> {
		return this.call<void>("fs_map_write", {
			rootId,
			path,
			offset,
			dataBase64: toBase64(data),
			truncate,
		});
	}

	async createFile(
		rootId: string,
		path: string,
	): Promise<NativeFilesystemEntry> {
		return toEntry(
			await this.call<unknown>("fs_map_create_file", { rootId, path }),
		);
	}

	async mkdir(rootId: string, path: string): Promise<NativeFilesystemEntry> {
		return toEntry(await this.call<unknown>("fs_map_mkdir", { rootId, path }));
	}

	unlink(rootId: string, path: string): Promise<void> {
		return this.call<void>("fs_map_unlink", { rootId, path });
	}

	rmdir(rootId: string, path: string): Promise<void> {
		return this.call<void>("fs_map_rmdir", { rootId, path });
	}

	rename(rootId: string, from: string, to: string): Promise<void> {
		return this.call<void>("fs_map_rename", { rootId, from, to });
	}

	touch(rootId: string, path: string, mtimeMs: number): Promise<void> {
		return this.call<void>("fs_map_touch", { rootId, path, mtimeMs });
	}

	async revision(
		rootId: string,
		path: string,
	): Promise<{ entries: number; maxMtimeMs: number }> {
		const value = await this.call<unknown>("fs_map_revision", {
			rootId,
			path,
		});
		const record = isRecord(value) ? value : {};
		return {
			entries: typeof record.entries === "number" ? record.entries : 0,
			maxMtimeMs: typeof record.maxMtimeMs === "number" ? record.maxMtimeMs : 0,
		};
	}

	async watch(
		listener: (change: NativeFolderChange) => void,
	): Promise<() => void> {
		return this.listen(FS_MAP_CHANGED_EVENT, (event) => {
			const payload = isRecord(event.payload) ? event.payload : {};
			if (typeof payload.rootId !== "string") return;
			listener({
				rootId: payload.rootId,
				paths: Array.isArray(payload.paths)
					? payload.paths.filter(
							(entry): entry is string => typeof entry === "string",
						)
					: [],
			});
		});
	}
}
