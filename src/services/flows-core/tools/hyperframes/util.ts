let _projectsRoot = "";

/**
 * Configure the root path under which HyperFrames projects are stored.
 * Call this during host app initialisation before any hyperframes tools run.
 * Example: setHyperframesProjectsRoot("/workspaces")
 */
export function setHyperframesProjectsRoot(root: string): void {
	_projectsRoot = root.replace(/\/+$/, "");
}

/**
 * Normalize any project path input to a canonical absolute path.
 * Accepts: full absolute paths, bare project names (no leading slash).
 * When a projects root is configured (via setHyperframesProjectsRoot),
 * bare names are placed under that root.
 */
export const normalizeProjectPath = (projectPath: string): string => {
	const normalized = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");

	// Empty input → return the configured root or "/"
	if (!normalized) return _projectsRoot || "/";

	// Already under configured root (exact match or prefix)
	if (
		_projectsRoot &&
		(normalized === _projectsRoot || normalized.startsWith(`${_projectsRoot}/`))
	) {
		return normalized;
	}

	// Bare name without leading slash → place under configured root
	if (!normalized.startsWith("/")) {
		return _projectsRoot ? `${_projectsRoot}/${normalized}` : `/${normalized}`;
	}

	// Absolute path → return as-is
	return normalized;
};

/** The composition HTML file inside a project directory. */
export const compositionFile = (projectPath: string): string =>
	`${normalizeProjectPath(projectPath)}/index.html`;
