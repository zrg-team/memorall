// ---------------------------------------------------------------------------
// path-policy.js — which paths cross between the sandbox and the host.
//
// Everything crosses, except:
// - git's store (`.git`): the host's own, since git runs on the host;
// - local trees, which stay in the sandbox and are kept in a cache on the
//   host instead (restored after a reset): dependency trees (`node_modules`)
//   at any depth, and cache folders a .gitignore ignores (.next, .cache,
//   coverage, __pycache__, .venv…). Build output (dist, build) and ignored
//   files (.env) still cross: the user sees and downloads them.
//
// src/services/sandbox-container/path-policy.ts is this file for the host;
// a test keeps the two the same.
// ---------------------------------------------------------------------------

export const DEPENDENCY_DIRS = new Set(["node_modules"]);
export const HOST_ONLY_DIRS = new Set([".git"]);
/** Cache folders: local when a .gitignore ignores them. */
export const CACHE_DIRS = new Set([
	".next",
	".nuxt",
	".svelte-kit",
	".turbo",
	".cache",
	".vite",
	".parcel-cache",
	"coverage",
	"__pycache__",
	".venv",
	"target",
]);

const escapeRegex = (text) => text.replace(/[.+^${}()|\\]/g, "\\$&");

/** A gitignore glob as a regular expression over a slash-separated path. */
const globToRegex = (glob) => {
	let out = "";
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index];
		if (char === "*") {
			if (glob[index + 1] === "*") {
				const atStart = index === 0 || glob[index - 1] === "/";
				const atEnd = index + 2 === glob.length || glob[index + 2] === "/";
				if (atStart && atEnd) {
					// `**/`: any folders, none included; a trailing `**`: anything.
					out += index + 2 === glob.length ? ".*" : "(?:.*/)?";
					index += 2;
					continue;
				}
			}
			out += "[^/]*";
		} else if (char === "?") {
			out += "[^/]";
		} else if (char === "[") {
			const close = glob.indexOf("]", index + 1);
			if (close < 0) {
				out += "\\[";
				continue;
			}
			let body = glob.slice(index + 1, close);
			if (body.startsWith("!")) body = `^${body.slice(1)}`;
			out += `[${body.replace(/\\/g, "\\\\")}]`;
			index = close;
		} else if (char === "\\" && index + 1 < glob.length) {
			out += escapeRegex(glob[index + 1]);
			index += 1;
		} else {
			out += escapeRegex(char);
		}
	}
	return out;
};

/** A .gitignore's rules, in order. */
export const compileGitignore = (content) => {
	const rules = [];
	for (const rawLine of String(content).split(/\r?\n/)) {
		let line = rawLine.replace(/(?<!\\)\s+$/, "");
		if (!line || line.startsWith("#")) continue;
		let negated = false;
		if (line.startsWith("!")) {
			negated = true;
			line = line.slice(1);
		} else if (line.startsWith("\\!") || line.startsWith("\\#")) {
			line = line.slice(1);
		}
		const dirOnly = line.endsWith("/");
		if (dirOnly) line = line.slice(0, -1);
		if (!line) continue;
		// A slash before the end anchors it to the .gitignore's folder.
		const anchored = line.includes("/");
		if (line.startsWith("/")) line = line.slice(1);
		const body = globToRegex(line);
		rules.push({
			negated,
			dirOnly,
			regex: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`),
		});
	}
	return rules;
};

/**
 * Whether a .gitignore's rules ignore a path relative to its folder: true,
 * false (re-included by a `!` rule), or undefined (no rule says).
 */
export const gitignoreVerdict = (rules, relativePath, isDir) => {
	let verdict;
	for (const rule of rules) {
		if (rule.dirOnly && !isDir) continue;
		if (rule.regex.test(relativePath)) verdict = !rule.negated;
	}
	return verdict;
};

const parentOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";

/**
 * The policy of a filesystem whose .gitignore files `readGitignore(dir)` reads
 * (null when a folder has none). Compiled rules are kept until `invalidate`.
 */
export const createPathPolicy = (readGitignore) => {
	const rulesByDir = new Map();
	const rulesOf = (dir) => {
		if (!rulesByDir.has(dir)) {
			let content = null;
			try {
				content = readGitignore(dir);
			} catch {
				content = null;
			}
			rulesByDir.set(dir, typeof content === "string" ? compileGitignore(content) : null);
		}
		return rulesByDir.get(dir);
	};

	/** Whether a .gitignore in it or above ignores a folder; deeper ones win. */
	const isIgnoredDir = (dir) => {
		let ignored = false;
		const ancestors = [];
		for (let current = parentOf(dir); ; current = parentOf(current)) {
			ancestors.unshift(current);
			if (current === "/") break;
		}
		for (const base of ancestors) {
			const rules = rulesOf(base);
			if (!rules?.length) continue;
			const relative = base === "/" ? dir.slice(1) : dir.slice(base.length + 1);
			const verdict = gitignoreVerdict(rules, relative, true);
			if (verdict !== undefined) ignored = verdict;
		}
		return ignored;
	};

	/** The local tree a path is in (the folder it starts at), or null. */
	const localRootOf = (path) => {
		if (typeof path !== "string" || !path.startsWith("/")) return null;
		let dir = "";
		for (const segment of path.split("/")) {
			if (!segment) continue;
			dir += `/${segment}`;
			if (HOST_ONLY_DIRS.has(segment)) return null;
			if (DEPENDENCY_DIRS.has(segment)) return dir;
			if (CACHE_DIRS.has(segment) && isIgnoredDir(dir)) return dir;
		}
		return null;
	};

	const isHostOnly = (path) =>
		path.split("/").some((segment) => HOST_ONLY_DIRS.has(segment));

	return {
		localRootOf,
		/** Whether a path crosses between the sandbox and the host. */
		isSynced: (path) =>
			typeof path === "string" &&
			path.startsWith("/") &&
			path !== "/" &&
			!isHostOnly(path) &&
			localRootOf(path) === null,
		/** A .gitignore changed: its folder's rules are read again. */
		invalidate: (dir) => {
			if (dir === undefined) rulesByDir.clear();
			else rulesByDir.delete(dir);
		},
	};
};
