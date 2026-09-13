import { makeRe, minimatch, Minimatch } from "minimatch";
import type { IFlowFileSystem } from "../../interfaces/services/filesystem.js";
import type { FsToolConfig } from "./config.js";

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
		if (part === "../index.js") {
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

/**
 * Directories a content search is essentially never aimed at, and which
 * dominate the cost of walking a real project folder.
 *
 * This matters far more here than it would for a local `find`. Every directory
 * is a round trip to the OS, and ZenFS stats each entry it lists, so a single
 * `node_modules` can turn a search into tens of thousands of calls — the
 * difference between a search that answers and one that is still running two
 * minutes later.
 *
 * A pattern that names one of these explicitly opts back in, so
 * `**\/node_modules/**\/license` still works.
 */
export const NOISE_DIRECTORIES: ReadonlySet<string> = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	"__pycache__",
	".venv",
	"venv",
	".mypy_cache",
	".pytest_cache",
	".tox",
	".cache",
	".turbo",
	".parcel-cache",
	".next",
	".nuxt",
	".svelte-kit",
	".gradle",
	".dart_tool",
	".terraform",
	"Pods",
]);

/** Why a walk stopped early, so callers can say so instead of under-reporting. */
export type WalkStopReason = "limit" | "time";

export interface WalkResult {
	entries: FsEntry[];
	/** True when the walk stopped before seeing everything. */
	truncated: boolean;
	stopReason?: WalkStopReason;
	/** Directories skipped as noise, for an honest summary line. */
	prunedDirectories: number;
	scannedDirectories: number;
}

export interface WalkOptions {
	recursive?: boolean;
	/** Stat every file for its size. Costs one extra call per file. */
	withSizes?: boolean;
	/** Stop after collecting this many entries. */
	limit?: number;
	/** Give up and return what we have. */
	timeBudgetMs?: number;
	/** Directories read at once. Each is a round trip, so this is the main dial. */
	concurrency?: number;
	/** Skip the usual build/VCS/cache directories. */
	pruneNoise?: boolean;
	/**
	 * Which directory names count as noise. Defaults to
	 * {@link NOISE_DIRECTORIES}; a consumer with a different ecosystem can pass
	 * its own rather than inherit this package's opinion.
	 */
	noiseDirectories?: ReadonlySet<string>;
	/** Extra per-directory test, e.g. "could this glob still match below here". */
	shouldDescend?: (displayPath: string, name: string) => boolean;
	/** Keep only the entries a caller actually wants, before the limit applies. */
	keep?: (entry: FsEntry) => boolean;
}

/** Files one grep will open before it starts reporting partial results. */
export const MAX_GREP_FILES = 2_000;

const DEFAULTS = {
	limit: 5_000,
	timeBudgetMs: 15_000,
	concurrency: 12,
};

/**
 * Walk a directory tree breadth-first, reading siblings concurrently.
 *
 * Breadth-first on purpose: the shallow results are the ones a person or an
 * agent usually wants, so a walk that has to stop early stops having found the
 * most useful matches rather than the deepest ones.
 *
 * Every directory read is isolated — one unreadable folder skips itself instead
 * of failing the search, which previously turned a permissions error anywhere
 * in the tree into "no files found".
 */
export async function walkEntries(
	fs: IFlowFileSystem,
	dirPath: string,
	options: WalkOptions = {},
	config?: FsToolConfig,
): Promise<WalkResult> {
	const {
		recursive = false,
		withSizes = false,
		limit = DEFAULTS.limit,
		timeBudgetMs = DEFAULTS.timeBudgetMs,
		concurrency = DEFAULTS.concurrency,
		pruneNoise = true,
		noiseDirectories = NOISE_DIRECTORIES,
		shouldDescend,
		keep,
	} = options;

	const displayRoot = normalizeFsPath(dirPath);
	const fsRoot = displayPathToFsPath(displayRoot, config);
	const deadline = Date.now() + timeBudgetMs;

	const entries: FsEntry[] = [];
	let truncated = false;
	let stopReason: WalkStopReason | undefined;
	let prunedDirectories = 0;
	let scannedDirectories = 0;

	const join = (base: string, name: string): string =>
		base === "/" ? `/${name}` : `${base}/${name}`;

	type Dir = { fsPath: string; displayPath: string };
	let frontier: Dir[] = [{ fsPath: fsRoot, displayPath: displayRoot }];

	const readDirectory = async (dir: Dir): Promise<Dir[]> => {
		const descendants: Dir[] = [];
		let dirents: Awaited<ReturnType<IFlowFileSystem["readdir"]>>;
		try {
			dirents = await fs.readdir(dir.fsPath, { withFileTypes: true });
		} catch {
			// Unreadable: skip this branch rather than fail the whole search.
			return descendants;
		}
		scannedDirectories += 1;

		const files: FsEntry[] = [];
		for (const dirent of dirents) {
			const name = dirent.name;
			const childDisplayPath = join(dir.displayPath, name);
			const isDirectory = dirent.isDirectory();
			const entry: FsEntry = {
				name,
				path: childDisplayPath,
				type: isDirectory ? "folder" : "file",
			};

			if (!keep || keep(entry)) {
				// A listing that already reported the size settles it; only fall
				// back to a stat when it did not.
				if (withSizes && !isDirectory && typeof dirent.size === "number") {
					entry.size = dirent.size;
				}
				if (isDirectory || !withSizes || entry.size !== undefined) {
					entries.push(entry);
				} else {
					files.push(entry);
				}
			}

			if (!recursive || !isDirectory) continue;
			if (pruneNoise && noiseDirectories.has(name)) {
				prunedDirectories += 1;
				continue;
			}
			if (shouldDescend && !shouldDescend(childDisplayPath, name)) continue;
			descendants.push({
				fsPath: join(dir.fsPath, name),
				displayPath: childDisplayPath,
			});
		}

		if (files.length > 0) {
			// One batch rather than one await per file: these are round trips too.
			await Promise.all(
				files.map(async (entry) => {
					try {
						entry.size = (
							await fs.stat(displayPathToFsPath(entry.path, config))
						).size;
					} catch {
						// Size is optional; the entry is still a real result.
					}
				}),
			);
			entries.push(...files);
		}

		return descendants;
	};

	while (frontier.length > 0) {
		if (entries.length >= limit) {
			truncated = true;
			stopReason = "limit";
			break;
		}
		if (Date.now() > deadline) {
			truncated = true;
			stopReason = "time";
			break;
		}

		const next: Dir[] = [];
		for (let i = 0; i < frontier.length; i += concurrency) {
			if (entries.length >= limit) {
				truncated = true;
				stopReason = "limit";
				break;
			}
			if (Date.now() > deadline) {
				truncated = true;
				stopReason = "time";
				break;
			}
			const batch = frontier.slice(i, i + concurrency);
			const results = await Promise.all(batch.map(readDirectory));
			for (const found of results) next.push(...found);
		}
		if (truncated) break;
		frontier = next;
	}

	return {
		entries: entries.length > limit ? entries.slice(0, limit) : entries,
		truncated,
		stopReason,
		prunedDirectories,
		scannedDirectories,
	};
}

/**
 * The deepest directory a pattern can possibly match under.
 *
 * `notes/2024/**\/*.md` can only match below `notes/2024`, so the walk starts
 * there instead of at the root. Patterns that begin with a wildcard have no
 * such prefix and start where they were asked to.
 */
export function globSearchRoot(pattern: string, basePath: string): string {
	const segments = pattern.split("/");
	const literal: string[] = [];
	let hitMagic = false;
	for (const segment of segments) {
		// Anything minimatch treats as magic ends the literal prefix.
		if (segment === "" || /[*?[\]{}()!+@]/.test(segment)) {
			hitMagic = true;
			break;
		}
		literal.push(segment);
	}
	// A pattern with no magic at all names a file, so its last segment is the
	// filename rather than a directory to search inside. One that stopped at a
	// wildcard ended on a real directory, which is exactly where to start.
	if (!hitMagic) literal.pop();
	if (literal.length === 0) return basePath;
	const suffix = literal.join("/");
	return basePath === "/" ? `/${suffix}` : `${basePath}/${suffix}`;
}

/**
 * A test for whether a directory can still lead to a match.
 *
 * This is what keeps `src/**\/*.ts` from reading `docs/` at all, rather than
 * reading everything and filtering afterwards. Patterns that open with `**`
 * genuinely can match anywhere, and this correctly refuses to prune for them —
 * the saving there comes from the noise list and the budget instead.
 */
export function globDescendFilter(
	pattern: string,
	basePath: string,
): (displayPath: string) => boolean {
	let matcher: Minimatch;
	try {
		matcher = new Minimatch(pattern);
	} catch {
		return () => true;
	}
	if (matcher.set.length === 0) return () => true;

	return (displayPath: string): boolean => {
		const relative =
			basePath === "/"
				? displayPath.slice(1)
				: displayPath.slice(basePath.length + 1);
		if (!relative) return true;
		const parts = relative.split("/");
		try {
			return matcher.set.some((set) => matcher.matchOne(parts, set, true));
		} catch {
			return true;
		}
	};
}

/** True when the pattern names a directory the walk would otherwise skip. */
export function globOptsIntoNoise(
	pattern: string,
	noiseDirectories: ReadonlySet<string> = NOISE_DIRECTORIES,
): boolean {
	for (const name of noiseDirectories) {
		if (pattern.includes(name)) return true;
	}
	return false;
}

/**
 * Flat listing of a directory, with sizes.
 *
 * Bounded by {@link walkEntries}' defaults rather than unbounded. A recursive
 * listing that reaches a mapped folder costs a round trip per directory, and
 * without a ceiling it ran for minutes and returned nothing usable — which no
 * caller actually wants. Callers that genuinely need every entry can use
 * `walkEntries` directly and say so.
 */
export async function listEntries(
	fs: IFlowFileSystem,
	dirPath: string,
	recursive = false,
	config?: FsToolConfig,
): Promise<FsEntry[]> {
	const result = await walkEntries(
		fs,
		dirPath,
		{ recursive, withSizes: true, pruneNoise: recursive },
		config,
	);
	return result.entries;
}

/**
 * The files a grep should open, found without reading the whole library.
 *
 * The caller's `glob` is applied *during* the walk rather than to a finished
 * listing, so a `**\/*.ts` search prunes every branch that cannot contain a
 * `.ts` file instead of enumerating the tree and discarding most of it. Build
 * and dependency directories are skipped unless the glob names one.
 */
export async function collectGrepFileNodes(
	fs: IFlowFileSystem,
	targetPath: string,
	glob?: string,
	config?: FsToolConfig,
	options: { limit?: number } = {},
): Promise<{ nodes: GrepFileNode[]; truncated: boolean }> {
	const searchRoot = glob ? globSearchRoot(glob, targetPath) : targetPath;
	const canDescend = glob ? globDescendFilter(glob, targetPath) : undefined;

	const matchesGlob = (entry: FsEntry): boolean => {
		if (!glob) return true;
		const rel =
			targetPath === "/"
				? entry.path.slice(1)
				: entry.path.slice(targetPath.length + 1);
		return globMatches(glob, glob.includes("/") ? rel : entry.name);
	};

	const walked = await walkEntries(
		fs,
		searchRoot,
		{
			recursive: true,
			withSizes: false,
			pruneNoise: !glob || !globOptsIntoNoise(glob),
			limit: options.limit ?? MAX_GREP_FILES,
			shouldDescend: canDescend
				? (displayPath) => canDescend(displayPath)
				: undefined,
			keep: (entry) => entry.type === "file" && matchesGlob(entry),
		},
		config,
	).catch(() => null);

	let entries = walked?.entries ?? [];
	if (entries.length === 0) {
		// The caller may have named a single file rather than a directory.
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

	return {
		nodes: entries.map((entry) => ({
			path: entry.path,
			displayPath: entry.path,
		})),
		truncated: walked?.truncated ?? false,
	};
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

		for (const [i, line] of lines.entries()) {
			contentRegex.lastIndex = 0;
			if (contentRegex.test(line)) {
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
