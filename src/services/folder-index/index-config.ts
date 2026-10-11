import {
	DEFAULT_MAX_INDEXED_FILE_BYTES,
	DEFAULT_SKIP_PATTERNS,
} from "./constants";
import type {
	FolderIndexConfig,
	FolderIndexRule,
	FolderIndexSettings,
} from "./types";

/**
 * Which folders have which index types. Pure: reading and writing the file is
 * the store's job, so the rules can be tested on their own.
 */

export const DEFAULT_FOLDER_INDEX_SETTINGS: FolderIndexSettings = {
	skipPatterns: [...DEFAULT_SKIP_PATTERNS],
	maxFileBytes: DEFAULT_MAX_INDEXED_FILE_BYTES,
	askBeforeMapped: true,
	agentsMayAsk: true,
};

export const emptyFolderIndexConfig = (): FolderIndexConfig => ({
	version: 1,
	folders: {},
	settings: {
		...DEFAULT_FOLDER_INDEX_SETTINGS,
		skipPatterns: [...DEFAULT_SKIP_PATTERNS],
	},
});

/** "/a/b/" and "a\\b" both become "/a/b"; the root is "/". */
export const normalizeFolderPath = (path: string): string => {
	const parts = path
		.replace(/\\/g, "/")
		.split("/")
		.filter((part) => part && part !== ".");
	return parts.length ? `/${parts.join("/")}` : "/";
};

/** The folder and its ancestors, root first: "/a/b" → ["/", "/a", "/a/b"]. */
export const folderLineage = (path: string): string[] => {
	const normalized = normalizeFolderPath(path);
	const lineage = ["/"];
	let current = "";
	for (const part of normalized.split("/").filter(Boolean)) {
		current = `${current}/${part}`;
		lineage.push(current);
	}
	return lineage;
};

export const parentFolder = (path: string): string | null => {
	const normalized = normalizeFolderPath(path);
	if (normalized === "/") return null;
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
};

export const isSameOrInside = (path: string, folder: string): boolean => {
	const target = normalizeFolderPath(path);
	const base = normalizeFolderPath(folder);
	return base === "/" || target === base || target.startsWith(`${base}/`);
};

const uniqueStrings = (values: unknown): string[] =>
	Array.isArray(values)
		? [
				...new Set(
					values
						.filter(
							(value): value is string =>
								typeof value === "string" && value.trim() !== "",
						)
						.map((value) => value.trim()),
				),
			]
		: [];

/** A config read from disk, with anything missing or malformed defaulted. */
export const normalizeFolderIndexConfig = (
	value: unknown,
): FolderIndexConfig => {
	const config = emptyFolderIndexConfig();
	if (!value || typeof value !== "object") return config;
	const raw = value as Partial<FolderIndexConfig>;

	if (raw.folders && typeof raw.folders === "object") {
		for (const [path, rule] of Object.entries(raw.folders)) {
			if (!rule || typeof rule !== "object") continue;
			const on = uniqueStrings((rule as FolderIndexRule).on);
			const off = uniqueStrings((rule as FolderIndexRule).off).filter(
				(type) => !on.includes(type),
			);
			if (!on.length && !off.length) continue;
			config.folders[normalizeFolderPath(path)] = {
				...(on.length ? { on } : {}),
				...(off.length ? { off } : {}),
			};
		}
	}

	const settings = raw.settings as Partial<FolderIndexSettings> | undefined;
	if (settings && typeof settings === "object") {
		if (Array.isArray(settings.skipPatterns)) {
			config.settings.skipPatterns = uniqueStrings(settings.skipPatterns);
		}
		if (
			typeof settings.maxFileBytes === "number" &&
			Number.isFinite(settings.maxFileBytes) &&
			settings.maxFileBytes > 0
		) {
			config.settings.maxFileBytes = Math.floor(settings.maxFileBytes);
		}
		if (typeof settings.askBeforeMapped === "boolean") {
			config.settings.askBeforeMapped = settings.askBeforeMapped;
		}
		if (typeof settings.agentsMayAsk === "boolean") {
			config.settings.agentsMayAsk = settings.agentsMayAsk;
		}
	}
	return config;
};

/** Index types in effect at `path`: each folder from the root adds and removes its own. */
export const effectiveIndexTypes = (
	config: FolderIndexConfig,
	path: string,
): string[] => {
	const types = new Set<string>();
	for (const folder of folderLineage(path)) {
		const rule = config.folders[folder];
		if (!rule) continue;
		for (const type of rule.off ?? []) types.delete(type);
		for (const type of rule.on ?? []) types.add(type);
	}
	return [...types].sort();
};

/**
 * Folders where `typeId` starts: in effect there but not in the parent. Each
 * is one bundle; everything below it that keeps the type belongs to it.
 */
export const indexRoots = (
	config: FolderIndexConfig,
	typeId: string,
): string[] =>
	Object.keys(config.folders)
		.filter((folder) => {
			if (!effectiveIndexTypes(config, folder).includes(typeId)) return false;
			const parent = parentFolder(folder);
			return (
				parent === null || !effectiveIndexTypes(config, parent).includes(typeId)
			);
		})
		.sort();

/** The index root of `typeId` that `path` belongs to, if any. */
export const indexRootOf = (
	config: FolderIndexConfig,
	typeId: string,
	path: string,
): string | null => {
	if (!effectiveIndexTypes(config, path).includes(typeId)) return null;
	const lineage = folderLineage(path);
	for (let index = lineage.length - 1; index >= 0; index -= 1) {
		const parent = index > 0 ? lineage[index - 1] : null;
		if (
			parent === null ||
			!effectiveIndexTypes(config, parent).includes(typeId)
		) {
			return lineage[index];
		}
	}
	return null;
};

/**
 * Sets whether `folder` has `typeId`. Turning a type on where it is inherited
 * only clears an "off"; turning it off where it is inherited records one, so
 * a subfolder can leave its parent's index.
 */
export const setFolderIndexType = (
	config: FolderIndexConfig,
	folder: string,
	typeId: string,
	enabled: boolean,
): FolderIndexConfig => {
	const path = normalizeFolderPath(folder);
	const folders = { ...config.folders };
	const rule = folders[path] ?? {};
	const on = new Set(rule.on ?? []);
	const off = new Set(rule.off ?? []);
	const parent = parentFolder(path);
	const inherited =
		parent !== null &&
		effectiveIndexTypes({ ...config, folders }, parent).includes(typeId);

	if (enabled) {
		off.delete(typeId);
		if (!inherited) on.add(typeId);
	} else {
		on.delete(typeId);
		if (inherited) off.add(typeId);
	}

	const next: FolderIndexRule = {
		...(on.size ? { on: [...on].sort() } : {}),
		...(off.size ? { off: [...off].sort() } : {}),
	};
	if (next.on || next.off) folders[path] = next;
	else delete folders[path];
	return { ...config, folders };
};

/** Keeps the config pointing at a folder after it is moved or renamed. */
export const moveFolderIndexRules = (
	config: FolderIndexConfig,
	from: string,
	to: string,
): FolderIndexConfig => {
	const source = normalizeFolderPath(from);
	const target = normalizeFolderPath(to);
	const folders: Record<string, FolderIndexRule> = {};
	for (const [path, rule] of Object.entries(config.folders)) {
		const moved =
			isSameOrInside(path, source) && source !== "/"
				? `${target}${path.slice(source.length)}` || "/"
				: path;
		folders[normalizeFolderPath(moved)] = rule;
	}
	return { ...config, folders };
};

/** Drops the rules of a deleted folder and everything in it. */
export const removeFolderIndexRules = (
	config: FolderIndexConfig,
	folder: string,
): FolderIndexConfig => {
	const target = normalizeFolderPath(folder);
	const folders = Object.fromEntries(
		Object.entries(config.folders).filter(
			([path]) => target === "/" || !isSameOrInside(path, target),
		),
	);
	return { ...config, folders };
};

const globToRegExp = (pattern: string): RegExp => {
	const escaped = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i");
};

/**
 * Whether a skip pattern excludes a name. A pattern ending in "/" names
 * folders; any other pattern names files.
 */
export const isSkippedName = (
	name: string,
	kind: "file" | "folder",
	patterns: readonly string[],
): boolean =>
	patterns.some((raw) => {
		const pattern = raw.trim();
		if (!pattern) return false;
		const folderPattern = pattern.endsWith("/");
		if (folderPattern !== (kind === "folder")) return false;
		return globToRegExp(folderPattern ? pattern.slice(0, -1) : pattern).test(
			name,
		);
	});
