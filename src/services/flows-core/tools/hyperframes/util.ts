/** Strip trailing slashes for consistent path handling. */
const normalize = (p: string): string =>
	p.trim().replace(/\\/g, "/").replace(/\/+$/, "");

const WORKSPACE_LEGACY_PATH = "workspace";
const WORKSPACES_PATH = "workspaces";

const INTERNAL_WORKSPACE_LEGACY_PREFIX = `/home/${WORKSPACE_LEGACY_PATH}`;
const INTERNAL_WORKSPACE_PREFIX = `/home/${WORKSPACES_PATH}`;

/** Normalize project paths into the public workspace namespace. */
export const normalizeProjectPath = (projectPath: string): string => {
	const normalized = normalize(projectPath);
	if (!normalized) return WORKSPACES_PATH;
	if (normalized === INTERNAL_WORKSPACE_PREFIX) return WORKSPACES_PATH;
	if (normalized.startsWith(`${INTERNAL_WORKSPACE_PREFIX}/`)) {
		return `${WORKSPACES_PATH}${normalized.slice(
			INTERNAL_WORKSPACE_PREFIX.length,
		)}`;
	}

	if (normalized === INTERNAL_WORKSPACE_LEGACY_PREFIX)
		return WORKSPACE_LEGACY_PATH;
	if (normalized.startsWith(`${INTERNAL_WORKSPACE_LEGACY_PREFIX}/`)) {
		return `${WORKSPACE_LEGACY_PATH}${normalized.slice(
			INTERNAL_WORKSPACE_LEGACY_PREFIX.length,
		)}`;
	}

	if (normalized === WORKSPACE_LEGACY_PATH) return WORKSPACE_LEGACY_PATH;
	if (normalized.startsWith(`${WORKSPACE_LEGACY_PATH}/`)) {
		return `${WORKSPACE_LEGACY_PATH}${normalized.slice(
			WORKSPACE_LEGACY_PATH.length,
		)}`;
	}
	if (normalized === WORKSPACES_PATH) return WORKSPACES_PATH;
	if (normalized.startsWith(`${WORKSPACES_PATH}/`))
		return `${WORKSPACES_PATH}${normalized.slice(WORKSPACES_PATH.length)}`;
	return `${WORKSPACES_PATH}/${normalized.replace(/^\/+/, "")}`;
};

/** The composition HTML file inside a project directory. */
export const compositionFile = (projectPath: string): string =>
	`${normalizeProjectPath(projectPath)}/index.html`;
