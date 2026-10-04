/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../../LICENSE).
 * Browser port: "~" expands to the home the caller passes (each agent has its
 * own Memon home and several can run in one page), and resolveReadPath skips
 * pi's macOS screenshot-filename fallbacks, which need sync disk checks and
 * never apply to Memon's file system.
 */
import { isAbsolute, resolve as resolvePath } from "../../../platform/path";

const UNICODE_SPACES = /[  -   　]/g;
function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function normalizeAtPrefix(filePath: string): string {
	return filePath.startsWith("@") ? filePath.slice(1) : filePath;
}

export function expandPath(filePath: string, home = "/"): string {
	const normalized = normalizeUnicodeSpaces(normalizeAtPrefix(filePath));
	if (normalized === "~") {
		return home;
	}
	if (normalized.startsWith("~/")) {
		return home.replace(/\/+$/, "") + normalized.slice(1);
	}
	return normalized;
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 */
export function resolveToCwd(
	filePath: string,
	cwd: string,
	home?: string,
): string {
	const expanded = expandPath(filePath, home);
	if (isAbsolute(expanded)) {
		return resolvePath(expanded);
	}
	return resolvePath(cwd, expanded);
}

export function resolveReadPath(
	filePath: string,
	cwd: string,
	home?: string,
): string {
	return resolveToCwd(filePath, cwd, home);
}
