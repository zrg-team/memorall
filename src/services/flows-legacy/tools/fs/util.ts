import { makeRe, minimatch } from "minimatch";
import type { IFlowFileSystem } from "@/services/flows-legacy/interfaces/services/filesystem";
import type { FsToolConfig } from "@/services/flows-legacy/tools/fs/config";

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

/** Normalize a display path for filesystem tool operations. */
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

export type FsPathResolver = (normalizedDisplayPath: string) => string;

export function displayPathToFsPath(
	path: string,
	config?: FsToolConfig,
): string {
	const normalized = normalizeFsPath(path);
	return config?.pathResolver?.(normalized) ?? normalized;
}

export async function pathExists(
	fs: IFlowFileSystem,
	path: string,
	config?: FsToolConfig,
): Promise<boolean> {
	try {
		await fs.access(displayPathToFsPath(path, config));
		return true;
	} catch {
		return false;
	}
}

export async function ensureParentDir(
	fs: IFlowFileSystem,
	filePath: string,
	config?: FsToolConfig,
): Promise<void> {
	const fsPath = displayPathToFsPath(filePath, config);
	const slash = fsPath.lastIndexOf("/");
	const parent = slash > 0 ? fsPath.slice(0, slash) : "/";
	await fs.mkdir(parent, { recursive: true });
}

export async function readFileBytes(
	fs: IFlowFileSystem,
	path: string,
	config?: FsToolConfig,
): Promise<Uint8Array> {
	return fs.readFile(displayPathToFsPath(path, config));
}

export async function writeFileBytes(
	fs: IFlowFileSystem,
	path: string,
	data: string | Uint8Array,
	createDirs = true,
	config?: FsToolConfig,
): Promise<void> {
	if (createDirs) {
		await ensureParentDir(fs, path, config);
	}
	await fs.writeFile(displayPathToFsPath(path, config), data);
}

export async function mkdirPath(
	fs: IFlowFileSystem,
	path: string,
	recursive = true,
	config?: FsToolConfig,
): Promise<void> {
	await fs.mkdir(displayPathToFsPath(path, config), { recursive });
}

export async function removePath(
	fs: IFlowFileSystem,
	path: string,
	recursive = false,
	config?: FsToolConfig,
): Promise<void> {
	await fs.rm(displayPathToFsPath(path, config), { recursive, force: false });
}

export async function listEntries(
	fs: IFlowFileSystem,
	dirPath: string,
	recursive = false,
	config?: FsToolConfig,
): Promise<FsEntry[]> {
	const displayRoot = normalizeFsPath(dirPath);
	const fsRoot = displayPathToFsPath(displayRoot, config);
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
	config?: FsToolConfig,
): Promise<GrepFileNode[]> {
	let entries = await listEntries(fs, targetPath, true, config).catch(() => []);
	if (entries.length === 0) {
		try {
			const stat = await fs.stat(displayPathToFsPath(targetPath, config));
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
