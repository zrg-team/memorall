/** Strip trailing slashes for consistent path handling. */
const normalize = (p: string): string =>
	p.trim().replace(/\\/g, "/").replace(/\/+$/, "");

const WORKSPACE_PREFIX = "/workspaces";
const LEGACY_WORKSPACE_PREFIX = "/workspace";
const INTERNAL_WORKSPACE_PREFIX = "/home/workspace";

/** Normalize project paths into the public workspace namespace. */
export const normalizeProjectPath = (projectPath: string): string => {
	const normalized = normalize(projectPath);
	if (!normalized) return WORKSPACE_PREFIX;
	if (normalized === INTERNAL_WORKSPACE_PREFIX) return WORKSPACE_PREFIX;
	if (normalized.startsWith(`${INTERNAL_WORKSPACE_PREFIX}/`)) {
		return `${WORKSPACE_PREFIX}${normalized.slice(
			INTERNAL_WORKSPACE_PREFIX.length,
		)}`;
	}
	if (normalized === LEGACY_WORKSPACE_PREFIX) return WORKSPACE_PREFIX;
	if (normalized.startsWith(`${LEGACY_WORKSPACE_PREFIX}/`)) {
		return `${WORKSPACE_PREFIX}${normalized.slice(
			LEGACY_WORKSPACE_PREFIX.length,
		)}`;
	}
	if (normalized === WORKSPACE_PREFIX) return normalized;
	if (normalized.startsWith(`${WORKSPACE_PREFIX}/`)) return normalized;
	return `${WORKSPACE_PREFIX}/${normalized.replace(/^\/+/, "")}`;
};

/** The composition HTML file inside a project directory. */
export const compositionFile = (projectPath: string): string =>
	`${normalizeProjectPath(projectPath)}/index.html`;
