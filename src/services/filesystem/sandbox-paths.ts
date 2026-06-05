/**
 * Canonical sandbox path utilities for the two filesystem scopes.
 *
 * Sandbox paths are the public-facing paths used by all UI, service,
 * and tool layers. They are symmetric with the internal ZenFS paths:
 *
 *   /documents/...  →  /home/documents/...
 *   /workspaces/... →  /home/workspaces/...
 *
 * All hardcoded "/documents" and "/workspaces" strings in the codebase
 * should be replaced with these constants and helpers.
 */

import { FILESYSTEM_MOUNT_PATH } from "./filesystem-paths";

// ── Constants ─────────────────────────────────────────────────────────────────

export const DOCUMENTS_SANDBOX_ROOT =
	FILESYSTEM_MOUNT_PATH.DOCUMENTS satisfies "/documents";

export const WORKSPACES_SANDBOX_ROOT =
	FILESYSTEM_MOUNT_PATH.WORKSPACES satisfies "/workspaces";

/** The internal ZenFS root that sandbox paths resolve to: "/home" + sandboxPath. */
export const SANDBOX_FS_PREFIX = "/home" as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SandboxScope = "documents" | "workspace";

// ── Type guards ───────────────────────────────────────────────────────────────

export function isDocumentsSandboxPath(path: string): boolean {
	return (
		path === DOCUMENTS_SANDBOX_ROOT ||
		path.startsWith(`${DOCUMENTS_SANDBOX_ROOT}/`)
	);
}

export function isWorkspacesSandboxPath(path: string): boolean {
	return (
		path === WORKSPACES_SANDBOX_ROOT ||
		path.startsWith(`${WORKSPACES_SANDBOX_ROOT}/`)
	);
}

// ── Path construction ─────────────────────────────────────────────────────────

/**
 * Convert a logical path (e.g. "/notes/todo.md", "/") to its documents
 * sandbox path (e.g. "/documents/notes/todo.md", "/documents").
 */
export function toDocumentsSandboxPath(logicalPath: string): string {
	return logicalPath === "/"
		? DOCUMENTS_SANDBOX_ROOT
		: `${DOCUMENTS_SANDBOX_ROOT}${logicalPath}`;
}

/**
 * Convert a logical path (e.g. "/project/index.html", "/") to its workspace
 * sandbox path (e.g. "/workspaces/project/index.html", "/workspaces").
 */
export function toWorkspacesSandboxPath(logicalPath: string): string {
	return logicalPath === "/"
		? WORKSPACES_SANDBOX_ROOT
		: `${WORKSPACES_SANDBOX_ROOT}${logicalPath}`;
}

/**
 * Convert a logical path to a sandbox path for the given scope.
 * Scope-driven alternative to the two typed helpers above.
 */
export function toSandboxPath(
	logicalPath: string,
	scope: SandboxScope,
): string {
	return scope === "workspace"
		? toWorkspacesSandboxPath(logicalPath)
		: toDocumentsSandboxPath(logicalPath);
}

// ── Path extraction ───────────────────────────────────────────────────────────

/**
 * Strip the /documents prefix from a sandbox path and return the logical path.
 * Returns null when the path does not belong to the documents scope.
 *
 * "/documents"       → "/"
 * "/documents/a/b"   → "/a/b"
 * "/workspaces/..."  → null
 */
export function toDocumentsLogicalPath(sandboxPath: string): string | null {
	if (sandboxPath === DOCUMENTS_SANDBOX_ROOT) return "/";
	if (sandboxPath.startsWith(`${DOCUMENTS_SANDBOX_ROOT}/`)) {
		return sandboxPath.slice(DOCUMENTS_SANDBOX_ROOT.length) || "/";
	}
	return null;
}

/**
 * Strip the /workspaces prefix from a sandbox path and return the logical path.
 * Returns null when the path does not belong to the workspaces scope.
 *
 * "/workspaces"          → "/"
 * "/workspaces/proj/x"   → "/proj/x"
 * "/documents/..."       → null
 */
export function toWorkspacesLogicalPath(sandboxPath: string): string | null {
	if (sandboxPath === WORKSPACES_SANDBOX_ROOT) return "/";
	if (sandboxPath.startsWith(`${WORKSPACES_SANDBOX_ROOT}/`)) {
		return sandboxPath.slice(WORKSPACES_SANDBOX_ROOT.length) || "/";
	}
	return null;
}

/**
 * Map a sandbox path directly to its internal ZenFS absolute path.
 * Throws for paths outside the known sandbox roots.
 *
 * "/documents/foo"  → "/home/documents/foo"
 * "/workspaces/foo" → "/home/workspaces/foo"
 */
export function sandboxPathToFsPath(sandboxPath: string): string {
	const normalized = sandboxPath.replace(/\/+$/, "");
	if (
		!isDocumentsSandboxPath(normalized) &&
		!isWorkspacesSandboxPath(normalized)
	) {
		throw new Error(
			`Invalid sandbox path "${sandboxPath}": must start with ${DOCUMENTS_SANDBOX_ROOT} or ${WORKSPACES_SANDBOX_ROOT}`,
		);
	}
	return `${SANDBOX_FS_PREFIX}${normalized}`;
}
