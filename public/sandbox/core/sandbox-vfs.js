// ---------------------------------------------------------------------------
// sandbox-vfs.js — Virtual filesystem overlay for the sandbox container.
// Handles the single root filesystem mount.
// ---------------------------------------------------------------------------

export const DOCUMENTS_MOUNT_ROOT = "/";
export const WORKSPACES_MOUNT_ROOT = "/";
export const VFS_DOCUMENTS_OVERLAY_FLAG = "__documentsOverlayInstalled";
export const VFS_WORKSPACE_MATERIALIZE_SYNC = "__memorallMaterializeWorkspaceFileSync";

// Boolean mount state — exported as an object so callers can assign across
// the ES module boundary (primitive re-assignment doesn't propagate in ESM).
export const vfsBoolState = {
	documentsMountLoaded: false,
	workspaceMountLoaded: false,
};

// Reference-type state (Sets / Maps / Arrays) — exported directly; callers
// mutate their contents freely.
export const mountedDocumentFiles = new Set();
export const mountedDocumentDirectories = new Set();
export const materializedMountedFiles = new Map();
export const mountedWorkspaceFiles = new Set();
export const mountedWorkspaceDirectories = new Set();
export const materializedWorkspaceFiles = new Map();
export const pendingWorkspaceOps = [];

// Sandbox code writes workspace files synchronously, but persisting them is an
// async round trip through the host. Writes queue in `pendingWorkspaceOps`, and
// the host is told shortly after that some are waiting, so files a
// long-running process writes reach the host while it runs rather than only
// when its command ends.
export const WORKSPACE_OPS_PENDING_CHANNEL = "memorall-sandbox-fs-pending";
/** Longest a read waits for the host to send a file it lacks. */
const FS_BRIDGE_TIMEOUT_MS = 30_000;
const WORKSPACE_OPS_NOTICE_DELAY_MS = 100;
let workspaceOpsNoticeTimer = null;

export const queueWorkspaceOp = (op) => {
	// A process rewriting one file in a loop only needs its last content sent.
	const last = pendingWorkspaceOps[pendingWorkspaceOps.length - 1];
	if (op.op === "write" && last?.op === "write" && last.path === op.path) {
		last.content = op.content;
	} else {
		pendingWorkspaceOps.push(op);
	}
	if (workspaceOpsNoticeTimer !== null || typeof window === "undefined") return;
	workspaceOpsNoticeTimer = setTimeout(() => {
		workspaceOpsNoticeTimer = null;
		if (pendingWorkspaceOps.length === 0) return;
		try {
			window.parent.postMessage({ channel: WORKSPACE_OPS_PENDING_CHANNEL }, "*");
		} catch (_) {}
	}, WORKSPACE_OPS_NOTICE_DELAY_MS);
};

// Dependency trees are runtime state. Persisting them through the host workspace
// bridge is both expensive and incorrect; package manifests remain workspace files.
const SANDBOX_LOCAL_ROOTS = ["/node_modules"];

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

export const normalizePath = (inputPath) => {
	if (typeof inputPath !== "string" || inputPath.length === 0) {
		throw new Error("Path must be a non-empty string");
	}
	const raw = inputPath.trim().replace(/\\/g, "/");
	if (!raw) throw new Error("Path must be a non-empty string");
	const candidate = (raw.startsWith("/") ? raw : `/${raw}`).replace(/\/+/g, "/");
	const parts = candidate.split("/").filter(Boolean);
	const resolved = [];
	for (const part of parts) {
		if (part === ".") continue;
		if (part === "..") {
			resolved.pop();
			continue;
		}
		resolved.push(part);
	}
	return resolved.length ? `/${resolved.join("/")}` : "/";
};

export const dirname = (inputPath) => {
	const normalized = normalizePath(inputPath);
	const idx = normalized.lastIndexOf("/");
	if (idx <= 0) return "/";
	return normalized.slice(0, idx);
};

export const toCanonicalMountedPath = (inputPath) => normalizePath(inputPath);

export const isDocumentsPath = (path) =>
	DOCUMENTS_MOUNT_ROOT !== WORKSPACES_MOUNT_ROOT &&
	(path === DOCUMENTS_MOUNT_ROOT || path.startsWith(`${DOCUMENTS_MOUNT_ROOT}/`));

export const isWorkspacePath = (path) =>
	WORKSPACES_MOUNT_ROOT === "/"
		? path.startsWith("/") &&
			!SANDBOX_LOCAL_ROOTS.some(
				(root) => path === root || path.startsWith(`${root}/`),
			)
		: path === WORKSPACES_MOUNT_ROOT ||
			path.startsWith(`${WORKSPACES_MOUNT_ROOT}/`);

export const assertDocumentsMountLoaded = () => {
	if (!vfsBoolState.documentsMountLoaded) {
		throw new Error("Documents mount is not loaded in sandbox runtime");
	}
};

export const assertWorkspaceMountLoaded = () => {
	if (!vfsBoolState.workspaceMountLoaded) {
		throw new Error("Workspace mount is not loaded in sandbox runtime");
	}
};

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

export const createFsError = (code, syscall, path) => {
	const messageByCode = {
		ENOENT: "no such file or directory",
		ENOTDIR: "not a directory",
		EISDIR: "illegal operation on a directory",
	};
	const message = messageByCode[code] || "filesystem error";
	const err = new Error(`${code}: ${message}, ${syscall} '${path}'`);
	err.code = code;
	err.syscall = syscall;
	err.path = path;
	return err;
};

/** The encoding a read asks for ("utf8" or { encoding: "utf8" }); null for bytes. */
export const requestedEncoding = (encodingOrOptions) => {
	if (typeof encodingOrOptions === "string") return encodingOrOptions;
	if (
		encodingOrOptions &&
		typeof encodingOrOptions === "object" &&
		typeof encodingOrOptions.encoding === "string"
	) {
		return encodingOrOptions.encoding;
	}
	return null;
};

/**
 * A mounted file's text as a read returns it: text when utf8 is asked for,
 * bytes otherwise, as Node and the AlmostNode VFS do. AlmostNode wraps the
 * bytes of an encoding-less read into a Buffer and cannot wrap a string.
 */
export const toMountedReadResult = (content, encodingOrOptions) => {
	const encoding = requestedEncoding(encodingOrOptions);
	if (content instanceof Uint8Array) {
		// A copy: the caller may change what it gets back.
		if (!encoding || encoding === "buffer") return new Uint8Array(content);
		if (encoding === "utf8" || encoding === "utf-8") {
			return new TextDecoder().decode(content);
		}
		return typeof Buffer !== "undefined"
			? Buffer.from(content).toString(encoding)
			: new TextDecoder().decode(content);
	}
	if (encoding === "utf8" || encoding === "utf-8") return content;
	const bytes = new TextEncoder().encode(content);
	if (!encoding || encoding === "buffer") return bytes;
	return typeof Buffer !== "undefined"
		? Buffer.from(bytes).toString(encoding)
		: content;
};

/** Bytes, not characters: servers send stat sizes as Content-Length. */
const mountedByteLength = (content) =>
	content instanceof Uint8Array
		? content.byteLength
		: typeof content === "string"
			? new TextEncoder().encode(content).byteLength
			: 0;

export const listMountedDir = (path, directories, files) => {
	const normalized = normalizePath(path);
	const prefix = normalized === "/" ? "/" : `${normalized}/`;
	const entries = new Set();

	for (const dir of directories) {
		if (!dir.startsWith(prefix) || dir === normalized) continue;
		const rest = dir.slice(prefix.length);
		if (!rest || rest.includes("/")) continue;
		entries.add(rest);
	}

	for (const filePath of files) {
		if (!filePath.startsWith(prefix)) continue;
		const rest = filePath.slice(prefix.length);
		if (!rest || rest.includes("/")) continue;
		entries.add(rest);
	}

	return Array.from(entries).sort();
};

export const createMountedStat = (path, isDirectory, size = 0) => {
	const mtime = new Date();
	return {
		size,
		mtime,
		isFile: () => !isDirectory,
		isDirectory: () => isDirectory,
		isSymbolicLink: () => false,
		path,
	};
};

export const ensureMountedParentDirectories = (inputPath, directories) => {
	const path = normalizePath(inputPath);
	const segments = path.split("/").filter(Boolean);
	let current = "";
	for (let i = 0; i < segments.length - 1; i++) {
		current += `/${segments[i]}`;
		directories.add(current);
	}
};

/**
 * A file's content as the runtime keeps it: text as a string, and a file that
 * is not UTF-8 text (an image, a font) as its bytes, which decoding would ruin.
 */
export const readMountedContent = (content) => {
	if (typeof content === "string") return content;
	let bytes = null;
	if (content instanceof Uint8Array) bytes = content;
	else if (ArrayBuffer.isView(content)) {
		bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	} else if (content instanceof ArrayBuffer) bytes = new Uint8Array(content);
	if (!bytes) return readMountedTextContent(content);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new Uint8Array(bytes);
	}
};

export const readMountedTextContent = (content) => {
	if (typeof content === "string") return content;
	if (content instanceof Uint8Array) return new TextDecoder().decode(content);
	if (ArrayBuffer.isView(content)) {
		return new TextDecoder().decode(
			new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
		);
	}
	if (content instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(content));
	}
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
};

export const materializeMountedDocumentFileContent = (inputPath, content) => {
	const path = normalizePath(inputPath);
	mountedDocumentFiles.add(path);
	ensureMountedParentDirectories(path, mountedDocumentDirectories);
	materializedMountedFiles.set(path, readMountedContent(content));
	return path;
};

export const addMountedWorkspaceDirectory = (inputPath) => {
	const path = toCanonicalMountedPath(inputPath);
	ensureMountedParentDirectories(path, mountedWorkspaceDirectories);
	mountedWorkspaceDirectories.add(path);
	return path;
};

export const materializeMountedWorkspaceFileContent = (inputPath, content) => {
	const path = toCanonicalMountedPath(inputPath);
	mountedWorkspaceFiles.add(path);
	ensureMountedParentDirectories(path, mountedWorkspaceDirectories);
	materializedWorkspaceFiles.set(path, readMountedContent(content));
	return path;
};

export const removeMountedWorkspacePath = (inputPath) => {
	const path = toCanonicalMountedPath(inputPath);
	if (mountedWorkspaceFiles.has(path)) {
		mountedWorkspaceFiles.delete(path);
		materializedWorkspaceFiles.delete(path);
		return path;
	}
	if (mountedWorkspaceDirectories.has(path)) {
		const prefix = `${path}/`;
		for (const file of Array.from(mountedWorkspaceFiles)) {
			if (file.startsWith(prefix)) {
				mountedWorkspaceFiles.delete(file);
				materializedWorkspaceFiles.delete(file);
			}
		}
		for (const dir of Array.from(mountedWorkspaceDirectories)) {
			if (dir !== WORKSPACES_MOUNT_ROOT && dir.startsWith(prefix)) {
				mountedWorkspaceDirectories.delete(dir);
			}
		}
		if (path !== WORKSPACES_MOUNT_ROOT) {
			mountedWorkspaceDirectories.delete(path);
		}
	}
	return path;
};

export const moveMountedWorkspacePath = (oldInputPath, newInputPath) => {
	const oldPath = toCanonicalMountedPath(oldInputPath);
	const newPath = toCanonicalMountedPath(newInputPath);
	if (mountedWorkspaceFiles.has(oldPath)) {
		mountedWorkspaceFiles.delete(oldPath);
		mountedWorkspaceFiles.add(newPath);
		ensureMountedParentDirectories(newPath, mountedWorkspaceDirectories);
		const content = materializedWorkspaceFiles.get(oldPath);
		materializedWorkspaceFiles.delete(oldPath);
		if (content !== undefined) {
			materializedWorkspaceFiles.set(newPath, content);
		}
		return { oldPath, newPath };
	}
	if (mountedWorkspaceDirectories.has(oldPath)) {
		const oldPrefix = `${oldPath}/`;
		const newPrefix = `${newPath}/`;
		const dirsToMove = Array.from(mountedWorkspaceDirectories).filter(
			(dir) => dir === oldPath || dir.startsWith(oldPrefix),
		);
		const filesToMove = Array.from(mountedWorkspaceFiles).filter((file) =>
			file.startsWith(oldPrefix),
		);
		const fileContents = new Map();
		for (const file of filesToMove) {
			if (materializedWorkspaceFiles.has(file)) {
				fileContents.set(file, materializedWorkspaceFiles.get(file));
			}
		}
		for (const dir of dirsToMove) mountedWorkspaceDirectories.delete(dir);
		for (const file of filesToMove) mountedWorkspaceFiles.delete(file);
		for (const file of filesToMove) materializedWorkspaceFiles.delete(file);
		addMountedWorkspaceDirectory(newPath);
		for (const dir of dirsToMove) {
			const moved =
				dir === oldPath ? newPath : `${newPrefix}${dir.slice(oldPrefix.length)}`;
			mountedWorkspaceDirectories.add(moved);
		}
		for (const file of filesToMove) {
			const moved = `${newPrefix}${file.slice(oldPrefix.length)}`;
			mountedWorkspaceFiles.add(moved);
			if (fileContents.has(file)) {
				materializedWorkspaceFiles.set(moved, fileContents.get(file) || "");
			}
		}
	}
	return { oldPath, newPath };
};

// ---------------------------------------------------------------------------
// VFS overlay — patches vfs.readFileSync / writeFileSync / etc. to intercept
// mounted root filesystem paths.
// ---------------------------------------------------------------------------

export const installDocumentsVfsOverlay = (vfs) => {
	if (!vfs || vfs[VFS_DOCUMENTS_OVERLAY_FLAG]) return;

	const original = {
		readdirSync: typeof vfs.readdirSync === "function" ? vfs.readdirSync.bind(vfs) : null,
		readFileSync: typeof vfs.readFileSync === "function" ? vfs.readFileSync.bind(vfs) : null,
		existsSync: typeof vfs.existsSync === "function" ? vfs.existsSync.bind(vfs) : null,
		statSync: typeof vfs.statSync === "function" ? vfs.statSync.bind(vfs) : null,
		lstatSync: typeof vfs.lstatSync === "function" ? vfs.lstatSync.bind(vfs) : null,
		accessSync: typeof vfs.accessSync === "function" ? vfs.accessSync.bind(vfs) : null,
		writeFileSync: typeof vfs.writeFileSync === "function" ? vfs.writeFileSync.bind(vfs) : null,
		mkdirSync: typeof vfs.mkdirSync === "function" ? vfs.mkdirSync.bind(vfs) : null,
		unlinkSync: typeof vfs.unlinkSync === "function" ? vfs.unlinkSync.bind(vfs) : null,
		renameSync: typeof vfs.renameSync === "function" ? vfs.renameSync.bind(vfs) : null,
	};

	// -------------------------------------------------------------------------
	// Parent bridge — async request/response and fire-and-forget notify channels
	// so the sandbox VFS can persist workspace changes to documentFileSystemService.
	// -------------------------------------------------------------------------
	const fsPending = new Map();

	const onFsResponse = (event) => {
		if (!event.data || event.data.channel !== "memorall-sandbox-fs-res") return;
		const pending = fsPending.get(event.data.requestId);
		if (!pending) return;
		fsPending.delete(event.data.requestId);
		if (event.data.ok) pending.resolve(event.data.result);
		else pending.reject(new Error(event.data.error ?? "fs async bridge error"));
	};
	window.addEventListener("message", onFsResponse);

	const sendFsRequest = (operation, payload) =>
		new Promise((resolve, reject) => {
			const requestId = Math.random().toString(36).slice(2, 12);
			// A host that never answers must not leave a read (and the request
			// of a server waiting on it) hanging forever.
			const timer = setTimeout(() => {
				fsPending.delete(requestId);
				reject(
					new Error(
						`The host did not answer ${operation} for ${payload?.path ?? "a file"} in time`,
					),
				);
			}, FS_BRIDGE_TIMEOUT_MS);
			fsPending.set(requestId, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			window.parent.postMessage(
				{ channel: "memorall-sandbox-fs-req", requestId, operation, payload },
				"*",
			);
		});

	const sendFsNotify = (operation, payload) => {
		try {
			window.parent.postMessage(
				{ channel: "memorall-sandbox-fs-notify", operation, payload },
				"*",
			);
		} catch (_) {}
	};

	vfs.readdirSync = (inputPath, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			assertDocumentsMountLoaded();
			if (!mountedDocumentDirectories.has(path)) {
				throw createFsError("ENOENT", "scandir", path);
			}
			return listMountedDir(path, mountedDocumentDirectories, mountedDocumentFiles);
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (!mountedWorkspaceDirectories.has(path)) {
				throw createFsError("ENOENT", "scandir", path);
			}
			return listMountedDir(path, mountedWorkspaceDirectories, mountedWorkspaceFiles);
		}
		if (!original.readdirSync) {
			throw new Error("vfs.readdirSync is not available");
		}
		return original.readdirSync(path, ...rest);
	};

	vfs.existsSync = (inputPath, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			if (!vfsBoolState.documentsMountLoaded) return false;
			return mountedDocumentFiles.has(path) || mountedDocumentDirectories.has(path);
		}
		if (isWorkspacePath(path)) {
			if (!vfsBoolState.workspaceMountLoaded) return false;
			return mountedWorkspaceFiles.has(path) || mountedWorkspaceDirectories.has(path);
		}
		if (!original.existsSync) return false;
		return original.existsSync(path, ...rest);
	};

	vfs.readFileSync = (inputPath, encoding, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			assertDocumentsMountLoaded();
			if (!mountedDocumentFiles.has(path)) {
				throw createFsError("ENOENT", "open", path);
			}
			if (!materializedMountedFiles.has(path)) {
				throw new Error(`Mounted file is not materialized in sandbox runtime: ${path}`);
			}
			return toMountedReadResult(
				materializedMountedFiles.get(path) || "",
				encoding,
			);
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (!mountedWorkspaceFiles.has(path)) {
				throw createFsError("ENOENT", "open", path);
			}
			if (!materializedWorkspaceFiles.has(path)) {
				throw new Error(`Workspace file not materialized: ${path}`);
			}
			return toMountedReadResult(
				materializedWorkspaceFiles.get(path) || "",
				encoding,
			);
		}
		if (!original.readFileSync) {
			throw new Error("vfs.readFileSync is not available");
		}
		return original.readFileSync(path, encoding, ...rest);
	};

	const statLike = (inputPath, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			assertDocumentsMountLoaded();
			if (mountedDocumentDirectories.has(path)) {
				return createMountedStat(path, true, 0);
			}
			if (mountedDocumentFiles.has(path)) {
				return createMountedStat(
					path,
					false,
					mountedByteLength(materializedMountedFiles.get(path)),
				);
			}
			throw createFsError("ENOENT", "stat", path);
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (mountedWorkspaceDirectories.has(path)) {
				return createMountedStat(path, true, 0);
			}
			if (mountedWorkspaceFiles.has(path)) {
				return createMountedStat(
					path,
					false,
					mountedByteLength(materializedWorkspaceFiles.get(path)),
				);
			}
			throw createFsError("ENOENT", "stat", path);
		}
		if (!original.statSync) {
			throw new Error("vfs.statSync is not available");
		}
		return original.statSync(path, ...rest);
	};
	vfs.statSync = statLike;
	vfs.lstatSync = (...args) => statLike(...args);

	vfs.accessSync = (inputPath, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			assertDocumentsMountLoaded();
			if (!mountedDocumentFiles.has(path) && !mountedDocumentDirectories.has(path)) {
				throw createFsError("ENOENT", "access", path);
			}
			return;
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (!mountedWorkspaceFiles.has(path) && !mountedWorkspaceDirectories.has(path)) {
				throw createFsError("ENOENT", "access", path);
			}
			return;
		}
		if (original.accessSync) {
			return original.accessSync(path, ...rest);
		}
	};

	vfs.writeFileSync = (inputPath, content, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			throw new Error(`Path is read-only: ${path}`);
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
		}
		if (!original.writeFileSync) {
			throw new Error("vfs.writeFileSync is not available");
		}
		original.writeFileSync(path, content, ...rest);
		if (isWorkspacePath(path)) {
			materializeMountedWorkspaceFileContent(path, content);
			queueWorkspaceOp({
				op: "write",
				path,
				content: materializedWorkspaceFiles.get(path) || "",
			});
		}
	};

	vfs[VFS_WORKSPACE_MATERIALIZE_SYNC] = (inputPath, content) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (!isWorkspacePath(path)) {
			throw new Error(`Materialized workspace file must be under ${WORKSPACES_MOUNT_ROOT}: ${path}`);
		}
		assertWorkspaceMountLoaded();
		const data = readMountedContent(content);
		materializeMountedWorkspaceFileContent(path, data);
		if (original.mkdirSync) {
			try {
				original.mkdirSync(dirname(path), { recursive: true });
			} catch (_) {}
		}
		if (original.writeFileSync) {
			original.writeFileSync(path, data);
		}
		return path;
	};

	vfs.mkdirSync = (inputPath, options, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		const hadWorkspaceDirectory = mountedWorkspaceDirectories.has(path);
		if (isDocumentsPath(path)) {
			throw new Error(`Path is read-only: ${path}`);
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
		}
		if (!original.mkdirSync) {
			throw new Error("vfs.mkdirSync is not available");
		}
		original.mkdirSync(path, options, ...rest);
		if (isWorkspacePath(path)) {
			addMountedWorkspaceDirectory(path);
			if (!hadWorkspaceDirectory) {
				queueWorkspaceOp({ op: "mkdir", path });
			}
		}
	};

	vfs.unlinkSync = (inputPath, ...rest) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isDocumentsPath(path)) {
			throw new Error(`Path is read-only: ${path}`);
		}
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
		}
		if (!original.unlinkSync) {
			throw new Error("vfs.unlinkSync is not available");
		}
		original.unlinkSync(path, ...rest);
		if (isWorkspacePath(path)) {
			removeMountedWorkspacePath(path);
			queueWorkspaceOp({ op: "delete", path });
		}
	};

	vfs.renameSync = (oldInputPath, newInputPath, ...rest) => {
		const oldPath = toCanonicalMountedPath(String(oldInputPath));
		const newPath = toCanonicalMountedPath(String(newInputPath));
		if (isDocumentsPath(oldPath) || isDocumentsPath(newPath)) {
			throw new Error(`Mounted documents path is read-only: ${oldPath} -> ${newPath}`);
		}
		if (isWorkspacePath(oldPath) || isWorkspacePath(newPath)) {
			assertWorkspaceMountLoaded();
			if (!isWorkspacePath(oldPath) || !isWorkspacePath(newPath)) {
				throw new Error(`Workspace rename must stay within workspace mount: ${oldPath} -> ${newPath}`);
			}
		}
		if (!original.renameSync) {
			throw new Error("vfs.renameSync is not available");
		}
		original.renameSync(oldPath, newPath, ...rest);
		if (isWorkspacePath(oldPath) || isWorkspacePath(newPath)) {
			moveMountedWorkspacePath(oldPath, newPath);
			queueWorkspaceOp({ op: "rename", oldPath, newPath });
		}
	};

	// -------------------------------------------------------------------------
	// Async methods — workspace/document paths go to the parent bridge
	// (documentFileSystemService) so all reads/writes are persisted.
	// Non-mounted paths fall back to the underlying sync VFS.
	// -------------------------------------------------------------------------

	// AlmostNode's callback API (fs.readFile(path, cb), fs.stat(path, cb), …)
	// hands its callback to these methods; the runtime's own callers await
	// the promise instead. Both get the same result.
	const settle = (pending, callback) => {
		if (typeof callback !== "function") return pending;
		pending.then(
			(value) => setTimeout(() => callback(null, value), 0),
			(error) => setTimeout(() => callback(error), 0),
		);
		return undefined;
	};

	const readFileAsync = async (inputPath, encodingOrOptions) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isWorkspacePath(path) || isDocumentsPath(path)) {
			// Content here is current: live sync and the sandbox's own writes
			// keep it so. Only a file the runtime lacks goes to the host.
			if (isWorkspacePath(path) && materializedWorkspaceFiles.has(path)) {
				return toMountedReadResult(
					materializedWorkspaceFiles.get(path) || "",
					encodingOrOptions,
				);
			}
			const result = await sendFsRequest("fs.readFile", {
				path,
				encoding: "utf8",
			});
			// Text, or bytes for a file that is not (an image, a font).
			const received =
				typeof result?.content === "string" ||
				result?.content instanceof Uint8Array;
			const content = received ? result.content : "";
			// Populate in-memory so subsequent sync reads (e.g. Vite internals) work.
			if (isWorkspacePath(path) && received) {
				materializeMountedWorkspaceFileContent(path, content);
				if (original.writeFileSync) original.writeFileSync(path, content);
			}
			return toMountedReadResult(content, encodingOrOptions);
		}
		if (!original.readFileSync) throw new Error("vfs.readFileSync is not available");
		const encoding = requestedEncoding(encodingOrOptions);
		return encoding
			? original.readFileSync(path, encoding)
			: original.readFileSync(path);
	};

	vfs.readFile = (inputPath, encodingOrOptions, callback) =>
		typeof encodingOrOptions === "function"
			? settle(readFileAsync(inputPath, undefined), encodingOrOptions)
			: settle(readFileAsync(inputPath, encodingOrOptions), callback);

	vfs.writeFile = async (inputPath, content) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (!original.writeFileSync) {
				throw new Error("vfs.writeFileSync is not available");
			}
			original.writeFileSync(path, content);
			materializeMountedWorkspaceFileContent(path, content);
			await sendFsRequest("fs.writeFile", {
				path,
				content: readMountedContent(content),
			});
			return;
		}
		vfs.writeFileSync(inputPath, content);
	};

	vfs.mkdir = async (inputPath, options) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (!original.mkdirSync) {
				throw new Error("vfs.mkdirSync is not available");
			}
			original.mkdirSync(path, options);
			addMountedWorkspaceDirectory(path);
			await sendFsRequest("fs.mkdir", {
				path,
				recursive: options?.recursive !== false,
			});
			return;
		}
		vfs.mkdirSync(inputPath, options);
	};

	vfs.readdir = async (inputPath) => vfs.readdirSync(inputPath);

	vfs.unlink = async (inputPath) => {
		const path = toCanonicalMountedPath(String(inputPath));
		if (isWorkspacePath(path)) {
			assertWorkspaceMountLoaded();
			if (!original.unlinkSync) {
				throw new Error("vfs.unlinkSync is not available");
			}
			original.unlinkSync(path);
			removeMountedWorkspacePath(path);
			await sendFsRequest("fs.unlink", { path });
			return;
		}
		vfs.unlinkSync(inputPath);
	};

	vfs.rename = async (oldInputPath, newInputPath) => {
		const oldPath = toCanonicalMountedPath(String(oldInputPath));
		const newPath = toCanonicalMountedPath(String(newInputPath));
		if (isWorkspacePath(oldPath)) {
			assertWorkspaceMountLoaded();
			if (!original.renameSync) {
				throw new Error("vfs.renameSync is not available");
			}
			original.renameSync(oldPath, newPath);
			moveMountedWorkspacePath(oldPath, newPath);
			await sendFsRequest("fs.rename", { oldPath, newPath });
			return;
		}
		vfs.renameSync(oldInputPath, newInputPath);
	};

	vfs.stat = (inputPath, callback) =>
		settle(
			Promise.resolve().then(() => vfs.statSync(inputPath)),
			callback,
		);

	vfs.lstat = (inputPath, callback) =>
		settle(
			Promise.resolve().then(() => vfs.lstatSync(inputPath)),
			callback,
		);

	vfs.access = (inputPath, mode, callback) => {
		const done = typeof mode === "function" ? mode : callback;
		const checkMode = typeof mode === "function" ? undefined : mode;
		return settle(
			Promise.resolve().then(() => {
				vfs.accessSync(inputPath, checkMode);
			}),
			done,
		);
	};

	vfs.exists = async (inputPath) => vfs.existsSync(String(inputPath));

	vfs[VFS_DOCUMENTS_OVERLAY_FLAG] = true;
};
