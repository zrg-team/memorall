/**
 * Canonical public filesystem path utilities.
 *
 * Memorall now exposes one filesystem rooted at "/". Legacy prefixed inputs
 * are accepted as compatibility inputs only and are
 * normalized away before storage access.
 */

import { FILESYSTEM_MOUNT_PATH } from "./filesystem-paths";

export const FILESYSTEM_SANDBOX_ROOT = FILESYSTEM_MOUNT_PATH.ROOT satisfies "/";

export const DOCUMENTS_SANDBOX_ROOT = FILESYSTEM_MOUNT_PATH.ROOT satisfies "/";

export const WORKSPACES_SANDBOX_ROOT = FILESYSTEM_MOUNT_PATH.ROOT satisfies "/";

export const LEGACY_DOCUMENTS_SANDBOX_ROOT = FILESYSTEM_MOUNT_PATH.DOCUMENTS;

export const LEGACY_WORKSPACES_SANDBOX_ROOT = FILESYSTEM_MOUNT_PATH.WORKSPACES;

export const SANDBOX_FS_PREFIX = "/home/files" as const;
export const LEGACY_DOCUMENTS_FS_ROOT =
	`/home${LEGACY_DOCUMENTS_SANDBOX_ROOT}` as const;
export const LEGACY_WORKSPACES_FS_ROOT =
	`/home${LEGACY_WORKSPACES_SANDBOX_ROOT}` as const;

export type SandboxScope = "root" | "documents" | "workspace";

const normalizeAbsolutePath = (path: string): string => {
	const raw = path.trim().replace(/\\/g, "/");
	const candidate = raw.startsWith("/") ? raw : `/${raw}`;
	const resolved: string[] = [];
	for (const part of candidate.split("/").filter(Boolean)) {
		if (part === ".") continue;
		if (part === "..") {
			resolved.pop();
			continue;
		}
		if (part.includes("\0")) {
			throw new Error(`Invalid filesystem path "${path}"`);
		}
		resolved.push(part);
	}
	return resolved.length ? `/${resolved.join("/")}` : "/";
};

export function normalizeSandboxPath(path: string): string {
	const normalized = normalizeAbsolutePath(path);
	if (
		normalized === LEGACY_DOCUMENTS_SANDBOX_ROOT ||
		normalized === LEGACY_WORKSPACES_SANDBOX_ROOT
	) {
		return FILESYSTEM_SANDBOX_ROOT;
	}
	if (normalized.startsWith(`${LEGACY_DOCUMENTS_SANDBOX_ROOT}/`)) {
		return normalized.slice(LEGACY_DOCUMENTS_SANDBOX_ROOT.length) || "/";
	}
	if (normalized.startsWith(`${LEGACY_WORKSPACES_SANDBOX_ROOT}/`)) {
		return normalized.slice(LEGACY_WORKSPACES_SANDBOX_ROOT.length) || "/";
	}
	return normalized;
}

export function isDocumentsSandboxPath(path: string): boolean {
	return Boolean(normalizeSandboxPath(path));
}

export function isWorkspacesSandboxPath(path: string): boolean {
	const normalized = normalizeAbsolutePath(path);
	return (
		normalized === LEGACY_WORKSPACES_SANDBOX_ROOT ||
		normalized.startsWith(`${LEGACY_WORKSPACES_SANDBOX_ROOT}/`)
	);
}

export function toDocumentsSandboxPath(logicalPath: string): string {
	return normalizeSandboxPath(logicalPath);
}

export function toWorkspacesSandboxPath(logicalPath: string): string {
	return normalizeSandboxPath(logicalPath);
}

export function toSandboxPath(
	logicalPath: string,
	_scope: SandboxScope = "root",
): string {
	return normalizeSandboxPath(logicalPath);
}

export function toDocumentsLogicalPath(sandboxPath: string): string | null {
	return normalizeSandboxPath(sandboxPath);
}

export function toWorkspacesLogicalPath(sandboxPath: string): string | null {
	return isWorkspacesSandboxPath(sandboxPath)
		? normalizeSandboxPath(sandboxPath)
		: null;
}

export function sandboxPathToFsPath(sandboxPath: string): string {
	const normalized = normalizeSandboxPath(sandboxPath);
	return normalized === FILESYSTEM_SANDBOX_ROOT
		? SANDBOX_FS_PREFIX
		: `${SANDBOX_FS_PREFIX}${normalized}`;
}
