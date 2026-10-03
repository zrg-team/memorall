// ---------------------------------------------------------------------------
// sandbox-vfs.js — paths of the sandbox's filesystem, and which of them the
// host shares. The files themselves live in the AlmostNode VFS; sandbox-sync.js
// keeps them in step with the host's.
// ---------------------------------------------------------------------------

/** The host's whole filesystem is the sandbox's, from its root. */
export const WORKSPACES_MOUNT_ROOT = "/";

/**
 * The runtime tells the host some changes are waiting to be saved, shortly
 * after the first one, so files a long-running process writes reach the host
 * while it runs rather than only when its command ends.
 */
export const WORKSPACE_OPS_PENDING_CHANNEL = "memorall-sandbox-fs-pending";

/** Dependency trees are the sandbox's own: installs are runtime state. */
const SANDBOX_LOCAL_SEGMENTS = new Set(["node_modules"]);
/** Git's store is the host's: git runs on the host, never in the sandbox. */
const HOST_ONLY_SEGMENTS = new Set([".git"]);

export const normalizePath = (inputPath) => {
	if (typeof inputPath !== "string" || inputPath.length === 0) {
		throw new Error("Path must be a non-empty string");
	}
	const raw = inputPath.trim().replace(/\\/g, "/");
	if (!raw) throw new Error("Path must be a non-empty string");
	const candidate = (raw.startsWith("/") ? raw : `/${raw}`).replace(/\/+/g, "/");
	const resolved = [];
	for (const part of candidate.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") resolved.pop();
		else resolved.push(part);
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

/**
 * Whether a path crosses between the sandbox and the host: everything but
 * dependency trees (`node_modules`, the sandbox's) and git's store (`.git`,
 * the host's), at any depth.
 */
export const isSyncedPath = (path) => {
	if (typeof path !== "string" || path === "/" || !path.startsWith("/")) {
		return false;
	}
	for (const segment of path.split("/")) {
		if (SANDBOX_LOCAL_SEGMENTS.has(segment) || HOST_ONLY_SEGMENTS.has(segment)) {
			return false;
		}
	}
	return true;
};

/** A host-backed path, as the rest of the runtime calls it. */
export const isWorkspacePath = isSyncedPath;
