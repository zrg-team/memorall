/**
 * pi's file access, on the agent's Memon file system.
 *
 * Each pi tool takes pluggable operations; these implement them over
 * IFlowFileSystem, and reuse the agent tools' own walker and glob helpers
 * (`fs_grep`, `fs_glob`) in place of ripgrep and fd.
 */
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import {
	collectGrepFileNodes,
	globDescendFilter,
	globMatches,
	globSearchRoot,
	literalToRegex,
	MAX_GREP_FILES,
	walkEntries,
} from "@memorall/agent-harness-flows/tools/fs/util";
import type { EditOperations } from "../coding-agent/core/tools/edit";
import type { FindOperations } from "../coding-agent/core/tools/find";
import type {
	GrepOperations,
	GrepSearchResult,
} from "../coding-agent/core/tools/grep";
import type { LsOperations } from "../coding-agent/core/tools/ls";
import type { ReadOperations } from "../coding-agent/core/tools/read";
import type { WriteOperations } from "../coding-agent/core/tools/write";
import type { SessionStore } from "../coding-agent/core/session-manager";
import { detectSupportedImageMimeType } from "../coding-agent/utils/mime";
import { dirname, join } from "../platform/path";
import type { TempFileSink } from "../platform/temp-files";
import type { AutocompleteFileSystem } from "../tui";

/** Files grep reads past this size are skipped (logs, bundles). */
const GREP_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** How long an @-mention search may walk before showing what it found. */
const AUTOCOMPLETE_WALK_MS = 1_500;

const decoder = new TextDecoder("utf-8", { fatal: false });

const isBinary = (bytes: Uint8Array): boolean =>
	bytes.subarray(0, 8_000).includes(0);

/** The relative path of `path` under `root` ("" for the root itself). */
const relativeTo = (root: string, path: string): string =>
	root === "/" ? path.replace(/^\//, "") : path.slice(root.length + 1);

export interface PiFileSystem {
	read: ReadOperations;
	write: WriteOperations;
	edit: EditOperations;
	ls: LsOperations;
	find: FindOperations;
	grep: GrepOperations;
	autocomplete: (homeDir: string) => AutocompleteFileSystem;
	sessions: SessionStore;
	tempFiles: (dir: string) => TempFileSink;
	readText: (path: string) => Promise<string | undefined>;
	writeText: (path: string, content: string) => Promise<void>;
}

export function createPiFileSystem(fs: IFlowFileSystem): PiFileSystem {
	const exists = (path: string) =>
		fs.access(path).then(
			() => true,
			() => false,
		);

	const ensureDir = async (dir: string) => {
		if (dir && dir !== "/") await fs.mkdir(dir, { recursive: true });
	};

	const readText = (path: string) =>
		fs.readFile(path, { encoding: "utf8" }).then(
			(text) => text,
			() => undefined,
		);

	const writeText = async (path: string, content: string) => {
		await ensureDir(dirname(path));
		await fs.writeFile(path, content, { encoding: "utf8" });
	};

	/** A readable regular file, or an error that reads like the OS one. */
	const accessFile = async (path: string) => {
		const stat = await fs.stat(path).catch(() => {
			throw new Error(`ENOENT: no such file or directory, access '${path}'`);
		});
		if (stat.isDirectory()) {
			throw new Error(
				`EISDIR: illegal operation on a directory, read '${path}'`,
			);
		}
	};

	const readBytes = (path: string) => fs.readFile(path);

	// ls stats every entry it lists; the listing already knows which are folders.
	const knownTypes = new Map<string, boolean>();

	const ls: LsOperations = {
		exists,
		async stat(path) {
			const known = knownTypes.get(path);
			if (known !== undefined) {
				knownTypes.delete(path);
				return { isDirectory: () => known };
			}
			const stat = await fs.stat(path);
			return { isDirectory: () => stat.isDirectory() };
		},
		async readdir(dir) {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries)
				knownTypes.set(join(dir, entry.name), entry.isDirectory());
			return entries.map((entry) => entry.name);
		},
	};

	const find: FindOperations = {
		exists,
		async glob(pattern, cwd, { limit }) {
			// fd --glob: a pattern without "/" matches the name, otherwise the path.
			const byPath = pattern.includes("/");
			const effectivePattern =
				byPath && !pattern.startsWith("/") && !pattern.startsWith("**/")
					? `**/${pattern}`
					: pattern;
			const root = byPath ? globSearchRoot(effectivePattern, cwd) : cwd;
			const canDescend = byPath
				? globDescendFilter(effectivePattern, cwd)
				: undefined;
			const walked = await walkEntries(fs, root, {
				recursive: true,
				limit,
				shouldDescend: canDescend
					? (displayPath) => canDescend(displayPath)
					: undefined,
				keep: (entry) =>
					byPath
						? globMatches(effectivePattern, relativeTo(cwd, entry.path))
						: globMatches(pattern, entry.name),
			});
			return walked.entries.map((entry) => entry.path);
		},
	};

	const grep: GrepOperations = {
		async isDirectory(path) {
			return (await fs.stat(path)).isDirectory();
		},
		readFile: async (path) => decoder.decode(await fs.readFile(path)),
		async search({
			pattern,
			path,
			glob,
			ignoreCase,
			literal,
			limit,
			signal,
		}): Promise<GrepSearchResult> {
			const flags = ignoreCase ? "i" : "";
			let regex: RegExp;
			try {
				regex = literal
					? literalToRegex(pattern, flags)
					: new RegExp(pattern, flags);
			} catch {
				regex = literalToRegex(pattern, flags);
			}
			const { nodes } = await collectGrepFileNodes(fs, path, glob, undefined, {
				limit: MAX_GREP_FILES,
			});
			const matches: GrepSearchResult["matches"] = [];
			for (const node of nodes) {
				if (signal?.aborted || matches.length >= limit) break;
				let bytes: Uint8Array;
				try {
					bytes = await fs.readFile(node.path);
				} catch {
					continue;
				}
				if (bytes.length > GREP_MAX_FILE_BYTES || isBinary(bytes)) continue;
				const lines = decoder.decode(bytes).split("\n");
				for (let index = 0; index < lines.length; index++) {
					const line = lines[index].replace(/\r$/, "");
					if (!regex.test(line)) continue;
					matches.push({
						filePath: node.path,
						lineNumber: index + 1,
						lineText: line,
					});
					if (matches.length >= limit) break;
				}
			}
			return { matches, limitReached: matches.length >= limit };
		},
	};

	return {
		read: {
			readFile: readBytes,
			access: accessFile,
			async detectImageMimeType(path) {
				return detectSupportedImageMimeType(await fs.readFile(path));
			},
		},
		write: {
			writeFile: writeText,
			mkdir: ensureDir,
		},
		edit: {
			readFile: readBytes,
			writeFile: (path, content) =>
				fs.writeFile(path, content, { encoding: "utf8" }),
			access: accessFile,
		},
		ls,
		find,
		grep,
		autocomplete: (homeDir) => ({
			homeDir,
			async readdir(dir) {
				const entries = await fs.readdir(dir, { withFileTypes: true });
				return entries.map((entry) => ({
					name: entry.name,
					isDirectory: entry.isDirectory(),
				}));
			},
			isDirectory: (path) => fs.stat(path).then((stat) => stat.isDirectory()),
			async walk(baseDir, query, maxResults, signal) {
				const needle = query.toLowerCase();
				const byPath = needle.includes("/");
				const walked = await walkEntries(fs, baseDir, {
					recursive: true,
					limit: maxResults,
					timeBudgetMs: AUTOCOMPLETE_WALK_MS,
					keep: (entry) => {
						if (signal.aborted) return false;
						const target = byPath
							? relativeTo(baseDir, entry.path)
							: entry.name;
						return target.toLowerCase().includes(needle);
					},
				});
				return walked.entries.map((entry) => ({
					path: `${relativeTo(baseDir, entry.path)}${entry.type === "folder" ? "/" : ""}`,
					isDirectory: entry.type === "folder",
				}));
			},
		}),
		sessions: {
			read: readText,
			write: writeText,
			async append(path, content) {
				if (!(await exists(path))) {
					await writeText(path, content);
					return;
				}
				await fs.appendFile(path, content);
			},
			list: (dir) => fs.readdir(dir).catch(() => [] as string[]),
		},
		tempFiles: (dir) => ({
			dir,
			async write(path, data) {
				await ensureDir(dirname(path));
				await fs.writeFile(path, data);
			},
		}),
		readText,
		writeText,
	};
}
