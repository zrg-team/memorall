import type { IFlowFileSystem } from "flow-core/interfaces/services/filesystem";
import type { FsToolConfig } from "flow-core/tools/fs/config";
import { listEntries, readFileBytes } from "flow-core/tools/fs/util";
import { normalizeProjectPath } from "flow-core/tools/hyperframes/util";

// ── Local image → data URL ────────────────────────────────────────────────────
// Images referenced as src="<documentRoot>/..." can't load inside the player
// iframe because those paths aren't real URLs. Read each file from the FS and
// replace it with a data URL that survives across frames and execution contexts.

const EXT_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
};

const mimeFor = (path: string): string =>
	EXT_MIME[path.split(".").pop()?.toLowerCase() ?? ""] ??
	"application/octet-stream";

const toBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
};

const fsPathCandidates = (docPath: string, root: string): string[] => {
	const stripped = docPath.startsWith(root)
		? docPath.slice(root.length) || "/"
		: docPath;
	return [stripped, docPath].filter(
		(path, index, paths) => path && paths.indexOf(path) === index,
	);
};

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"ico",
]);

const LOCAL_URL_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;

const stripUrlMeta = (path: string): string => path.split(/[?#]/, 1)[0] ?? path;

const normalizeRelativePath = (path: string): string =>
	path
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\/+/, "")
		.replace(/\/+/g, "/");

const hasImageExtension = (path: string): boolean => {
	const clean = stripUrlMeta(path).toLowerCase();
	const extension = clean.split(".").pop() ?? "";
	return IMAGE_EXTENSIONS.has(extension);
};

const isLocalImageRef = (path: string): boolean => {
	const trimmed = path.trim();
	if (!trimmed || trimmed.startsWith("#")) return false;
	if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return false;
	if (LOCAL_URL_PROTOCOL.test(trimmed)) return false;
	return hasImageExtension(trimmed);
};

export const collectLocalImageReferences = (html: string): string[] => {
	const refs = new Set<string>();
	const add = (value: string | undefined) => {
		if (value && isLocalImageRef(value)) refs.add(value.trim());
	};

	for (const match of html.matchAll(
		/\b(?:src|href|poster)=["']([^"']+)["']/gi,
	)) {
		add(match[1]);
	}

	for (const match of html.matchAll(
		/\b(?:background(?:Image)?|mask(?:Image)?)\s*:\s*["']?url\(([^)]+)\)/gi,
	)) {
		add(match[1]?.trim().replace(/^["']|["']$/g, ""));
	}

	for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
		add(match[1]);
	}

	for (const match of html.matchAll(
		/(["'])([^"']+\.(?:png|jpe?g|gif|webp|svg|ico)(?:[?#][^"']*)?)\1/gi,
	)) {
		add(match[2]);
	}

	return [...refs];
};

type ResourceIndex = Map<string, string[]>;

const createResourceIndex = async (
	dfs: IFlowFileSystem,
	projectPath: string,
	config?: FsToolConfig,
): Promise<ResourceIndex> => {
	const index: ResourceIndex = new Map();
	if (!projectPath) return index;

	let entries;
	try {
		entries = await listEntries(dfs, projectPath, true, config);
	} catch {
		return index;
	}

	for (const entry of entries) {
		if (entry.type !== "file" || !hasImageExtension(entry.path)) continue;
		const filename = entry.name.toLowerCase();
		const existing = index.get(filename) ?? [];
		existing.push(entry.path);
		index.set(filename, existing);
	}

	return index;
};

export interface ResolveLocalImageOptions {
	projectPath?: string;
	resourceIndex?: ResourceIndex;
	resourceRoots?: string[];
	fs?: FsToolConfig;
}

export const resolveLocalImagePath = async (
	dfs: IFlowFileSystem,
	ref: string,
	options: ResolveLocalImageOptions = {},
): Promise<string | null> => {
	if (!isLocalImageRef(ref)) return null;

	const cleanRef = stripUrlMeta(normalizeRelativePath(ref));
	const projectPath = options.projectPath
		? normalizeProjectPath(options.projectPath)
		: "";
	const candidates: string[] = [];

	const resourceRoots = (options.resourceRoots ?? []).map((r) =>
		r.replace(/\/+$/, ""),
	);
	const matchingRoot =
		resourceRoots.find((r) => cleanRef === r || cleanRef.startsWith(`${r}/`)) ??
		"";
	if (matchingRoot) {
		candidates.push(...fsPathCandidates(cleanRef, matchingRoot));
	}

	if (cleanRef.startsWith("/")) {
		candidates.push(cleanRef);
	} else if (projectPath) {
		candidates.push(`${projectPath}/${cleanRef}`);
		candidates.push(`${projectPath}/resources/${cleanRef}`);
		if (!cleanRef.startsWith("resources/")) {
			const filename = cleanRef.split("/").pop();
			if (filename)
				candidates.push(`${projectPath}/resources/images/${filename}`);
		}
	}

	const uniqueCandidates = candidates.filter(
		(path, index, paths) => path && paths.indexOf(path) === index,
	);
	for (const candidate of uniqueCandidates) {
		try {
			await readFileBytes(dfs, candidate, options.fs);
			return candidate;
		} catch {
			// Try the next candidate.
		}
	}

	const filename = cleanRef.split("/").pop()?.toLowerCase();
	const fuzzyMatches = filename
		? options.resourceIndex?.get(filename)
		: undefined;
	return fuzzyMatches?.length === 1 ? fuzzyMatches[0] : null;
};

const injectLocalImages = async (
	html: string,
	dfs: IFlowFileSystem,
	projectPath?: string,
	rootPath?: string,
	resourceRoots?: string[],
	fsConfig?: FsToolConfig,
): Promise<string> => {
	const refs = collectLocalImageReferences(html);
	if (refs.length === 0) return html;

	const normalizedProjectPath = projectPath
		? normalizeProjectPath(projectPath, rootPath)
		: "";
	const resourceIndex = normalizedProjectPath
		? await createResourceIndex(dfs, normalizedProjectPath, fsConfig)
		: new Map();

	let result = html;
	for (const ref of [...refs].sort((a, b) => b.length - a.length)) {
		const filePath = await resolveLocalImagePath(dfs, ref, {
			projectPath: normalizedProjectPath,
			resourceIndex,
			resourceRoots,
			fs: fsConfig,
		});
		if (!filePath) continue;

		try {
			const bytes = await readFileBytes(dfs, filePath, fsConfig);
			const dataUrl = `data:${mimeFor(filePath)};base64,${toBase64(bytes)}`;
			result = result.replaceAll(ref, dataUrl);
		} catch {
			// Keep the original reference; validation reports unresolved assets.
		}
	}

	return result;
};

export const unresolvedLocalImageReferences = async (
	html: string,
	dfs: IFlowFileSystem,
	projectPath?: string,
	rootPath?: string,
	resourceRoots?: string[],
	fsConfig?: FsToolConfig,
): Promise<string[]> => {
	const refs = collectLocalImageReferences(html);
	if (refs.length === 0) return [];

	const normalizedProjectPath = projectPath
		? normalizeProjectPath(projectPath, rootPath)
		: "";
	const resourceIndex = normalizedProjectPath
		? await createResourceIndex(dfs, normalizedProjectPath, fsConfig)
		: new Map();

	const missing: string[] = [];
	for (const ref of refs) {
		const resolved = await resolveLocalImagePath(dfs, ref, {
			projectPath: normalizedProjectPath,
			resourceIndex,
			resourceRoots,
			fs: fsConfig,
		});
		if (!resolved) missing.push(ref);
	}

	return missing;
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Preprocess a HyperFrames composition HTML for safe rendering inside an
 * iframe:
 *
 * 1. Local image references under document roots or project resources → data
 *    URLs. Fixes local document/project images that can't load as bare paths
 *    in the iframe.
 *
 * Pass resourceRoots to rewrite images under those virtual path prefixes.
 * Inline scripts are left executable, but local image string literals inside
 * them are rewritten when they can be resolved to project resources.
 */
export const preprocessComposition = async (
	html: string,
	dfs: IFlowFileSystem,
	options: {
		projectPath?: string;
		rootPath?: string;
		resourceRoots?: string[];
		fs?: FsToolConfig;
	} = {},
): Promise<string> => {
	return injectLocalImages(
		html,
		dfs,
		options.projectPath,
		options.rootPath,
		options.resourceRoots,
		options.fs,
	);
};
