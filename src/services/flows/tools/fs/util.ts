import { makeRe, minimatch } from "minimatch";
import type { IFlowFileSystem } from "../../interfaces/filesystem";

export interface FsEntry {
	name: string;
	path: string;
	type: "file" | "folder";
	size?: number;
}

export interface GrepFileNode {
	path: string;
	displayPath: string;
}

export type GrepOutputMode = "content" | "files_with_matches" | "count";

export interface GrepOptions {
	pattern: string;
	targetPath: string;
	glob?: string;
	caseSensitive?: boolean;
	context?: number;
	maxResults?: number;
	outputMode?: GrepOutputMode;
}

export type ResolvedGrepOptions = Omit<Required<GrepOptions>, "glob"> & {
	glob?: string;
};

/**
 * Normalize a logical document path (same rules as the documents/ util,
 * but kept local so documents-fs stays self-contained).
 */
export function normalizeFsPath(inputPath: string): string {
	const raw = inputPath.trim().replace(/\\/g, "/");
	if (!raw) return "/";
	const candidate = raw.startsWith("/") ? raw : `/${raw}`;
	const parts = candidate.split("/").filter(Boolean);
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === ".") continue;
		if (part === "..") {
			resolved.pop();
			continue;
		}
		resolved.push(part);
	}
	let normalized = resolved.length ? `/${resolved.join("/")}` : "/";
	// Strip leading "/documents" prefix so callers can use either form
	return normalized;
}

const REGEX_SPECIAL_CHARS = /[\\^$.*+?()[\]{}|]/g;

const escapeRegex = (value: string): string =>
	value.replace(REGEX_SPECIAL_CHARS, "\\$&");

/**
 * Match with minimatch semantics so tool behavior stays aligned with common
 * npm glob APIs instead of a partial hand-rolled glob parser.
 */
export function globMatches(pattern: string, value: string): boolean {
	return minimatch(value, pattern);
}

export function globToRegex(pattern: string): RegExp {
	const regex = makeRe(pattern);
	return regex === false ? /^$/ : regex;
}

export const literalToRegex = (value: string, flags: string): RegExp =>
	new RegExp(escapeRegex(value), flags);

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Return true when nodePath is inside (or equal to) scopePath. */
export function isInScope(nodePath: string, scopePath: string): boolean {
	if (scopePath === "/") return true;
	return nodePath === scopePath || nodePath.startsWith(`${scopePath}/`);
}

// ── Workspace path helpers ────────────────────────────────────────────────────

export const WORKSPACE_PREFIX = "/workspaces";
const DOCUMENTS_PREFIX = "/documents";
const WORKSPACE_FS_ROOT = "/home/workspace";

/** True when path addresses the workspace namespace (/workspaces or /workspaces/...). */
export function isWorkspacePath(path: string): boolean {
	return path === WORKSPACE_PREFIX || path.startsWith(WORKSPACE_PREFIX + "/");
}

/**
 * Convert a workspace tree node's logical path (e.g. /myproject/src) to its
 * display path used by the tools (e.g. /workspaces/myproject/src).
 * Workspace tree nodes use "/" as root, so we prefix with /workspaces.
 */
export function wsNodeToDisplayPath(logicalPath: string): string {
	if (logicalPath === "/") return WORKSPACE_PREFIX;
	return `${WORKSPACE_PREFIX}${logicalPath}`;
}

/**
 * Strip the /workspaces prefix to get the workspace tree logical path.
 *   /workspaces            → /
 *   /workspaces/myproject  → /myproject
 */
export function wsDisplayToLogicalPath(displayPath: string): string {
	if (displayPath === WORKSPACE_PREFIX) return "/";
	return displayPath.slice(WORKSPACE_PREFIX.length);
}

/**
 * Strip /documents prefix so callers can address either namespace form.
 *   /documents/notes/todo.md → /notes/todo.md
 *   /documents               → /
 *   /notes/todo.md           → /notes/todo.md  (bare path, unchanged)
 */
export function stripDocumentsPrefix(path: string): string {
	if (path === DOCUMENTS_PREFIX) return "/";
	if (path.startsWith(DOCUMENTS_PREFIX + "/"))
		return path.slice(DOCUMENTS_PREFIX.length);
	return path;
}

export function displayPathToFsPath(path: string): string {
	const normalized = normalizeFsPath(path);
	if (isWorkspacePath(normalized)) {
		const logical = wsDisplayToLogicalPath(normalized);
		return logical === "/"
			? WORKSPACE_FS_ROOT
			: `${WORKSPACE_FS_ROOT}${logical}`;
	}
	return stripDocumentsPrefix(normalized);
}

export async function pathExists(
	fs: IFlowFileSystem,
	path: string,
): Promise<boolean> {
	try {
		await fs.access(displayPathToFsPath(path));
		return true;
	} catch {
		return false;
	}
}

export async function ensureParentDir(
	fs: IFlowFileSystem,
	filePath: string,
): Promise<void> {
	const fsPath = displayPathToFsPath(filePath);
	const slash = fsPath.lastIndexOf("/");
	const parent = slash > 0 ? fsPath.slice(0, slash) : "/";
	await fs.mkdir(parent, { recursive: true });
}

export async function readFileBytes(
	fs: IFlowFileSystem,
	path: string,
): Promise<Uint8Array> {
	return fs.readFile(displayPathToFsPath(path));
}

export async function writeFileBytes(
	fs: IFlowFileSystem,
	path: string,
	data: string | Uint8Array,
	createDirs = true,
): Promise<void> {
	if (createDirs) {
		await ensureParentDir(fs, path);
	}
	await fs.writeFile(displayPathToFsPath(path), data);
}

export async function mkdirPath(
	fs: IFlowFileSystem,
	path: string,
	recursive = true,
): Promise<void> {
	await fs.mkdir(displayPathToFsPath(path), { recursive });
}

export async function removePath(
	fs: IFlowFileSystem,
	path: string,
	recursive = false,
): Promise<void> {
	await fs.rm(displayPathToFsPath(path), { recursive, force: false });
}

export async function listEntries(
	fs: IFlowFileSystem,
	dirPath: string,
	recursive = false,
): Promise<FsEntry[]> {
	const displayRoot = normalizeFsPath(dirPath);
	const fsRoot = displayPathToFsPath(displayRoot);
	const entries: FsEntry[] = [];

	const visit = async (currentFsPath: string, currentDisplayPath: string) => {
		const dirents = await fs.readdir(currentFsPath, { withFileTypes: true });
		for (const dirent of dirents) {
			const childFsPath =
				currentFsPath === "/"
					? `/${dirent.name}`
					: `${currentFsPath}/${dirent.name}`;
			const childDisplayPath =
				currentDisplayPath === "/"
					? `/${dirent.name}`
					: `${currentDisplayPath}/${dirent.name}`;
			const isDirectory = dirent.isDirectory();
			const entry: FsEntry = {
				name: dirent.name,
				path: childDisplayPath,
				type: isDirectory ? "folder" : "file",
			};
			if (!isDirectory) {
				try {
					entry.size = (await fs.stat(childFsPath)).size;
				} catch {
					// Size is optional; listing should still work if stat is unavailable.
				}
			}
			entries.push(entry);
			if (recursive && isDirectory) {
				await visit(childFsPath, childDisplayPath);
			}
		}
	};

	await visit(fsRoot, displayRoot);
	return entries;
}

export async function collectGrepFileNodes(
	fs: IFlowFileSystem,
	targetPath: string,
	glob?: string,
): Promise<GrepFileNode[]> {
	let entries = await listEntries(fs, targetPath, true).catch(() => []);
	if (entries.length === 0) {
		try {
			const stat = await fs.stat(displayPathToFsPath(targetPath));
			if (stat.isFile()) {
				entries = [
					{
						name: targetPath.split("/").pop() ?? targetPath,
						path: targetPath,
						type: "file",
						size: stat.size,
					},
				];
			}
		} catch {
			// Keep empty entries; caller will report no files found.
		}
	}

	return entries
		.filter((entry) => {
			if (entry.type !== "file") return false;
			if (glob) {
				const rel =
					targetPath === "/"
						? entry.path.slice(1)
						: entry.path.slice(targetPath.length + 1);
				const testStr = glob?.includes("/") ? rel : entry.name;
				if (!globMatches(glob, testStr)) return false;
			}
			return true;
		})
		.map((entry) => ({ path: entry.path, displayPath: entry.path }));
}

export async function runGrep(
	fileNodes: GrepFileNode[],
	readFile: (displayPath: string) => Promise<Uint8Array>,
	options: ResolvedGrepOptions,
): Promise<string> {
	let contentRegex: RegExp;
	const flags = options.caseSensitive ? "g" : "gi";
	try {
		contentRegex = new RegExp(options.pattern, flags);
	} catch {
		contentRegex = literalToRegex(options.pattern, flags);
	}

	const outputLines: string[] = [];
	let totalMatches = 0;
	let filesWithMatches = 0;

	for (const node of fileNodes) {
		if (totalMatches >= options.maxResults) break;

		let text: string;
		try {
			const raw = await readFile(node.displayPath);
			text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
		} catch {
			continue;
		}

		const lines = text.split(/\r?\n/);
		const matchingLineNums: number[] = [];

		for (let i = 0; i < lines.length; i++) {
			contentRegex.lastIndex = 0;
			if (contentRegex.test(lines[i])) {
				matchingLineNums.push(i);
			}
		}

		if (matchingLineNums.length === 0) continue;

		filesWithMatches++;

		if (options.outputMode === "files_with_matches") {
			outputLines.push(node.displayPath);
			totalMatches++;
			continue;
		}

		if (options.outputMode === "count") {
			outputLines.push(`${node.displayPath}:${matchingLineNums.length}`);
			totalMatches++;
			continue;
		}

		const emitted = new Set<number>();
		let previousEnd = -1;
		for (const matchLine of matchingLineNums) {
			if (totalMatches >= options.maxResults) break;
			const start = Math.max(0, matchLine - options.context);
			const end = Math.min(lines.length - 1, matchLine + options.context);

			if (options.context > 0 && previousEnd >= 0 && start > previousEnd + 1) {
				outputLines.push("--");
			}

			for (let lineIndex = start; lineIndex <= end; lineIndex++) {
				if (emitted.has(lineIndex)) continue;
				emitted.add(lineIndex);
				const sep = lineIndex === matchLine ? ":" : "-";
				outputLines.push(
					`${node.displayPath}:${lineIndex + 1}${sep}${lines[lineIndex]}`,
				);
			}

			previousEnd = Math.max(previousEnd, end);
			totalMatches++;
		}
	}

	if (outputLines.length === 0) {
		return `No matches found for "${options.pattern}"${options.glob ? ` in files matching "${options.glob}"` : ""} under "${options.targetPath}"`;
	}

	const summary =
		options.outputMode === "content"
			? `\n\n${totalMatches} match${totalMatches !== 1 ? "es" : ""} in ${filesWithMatches} file${filesWithMatches !== 1 ? "s" : ""}`
			: "";

	return `${outputLines.join("\n")}${summary}`;
}
