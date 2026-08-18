/**
 * Normalize any project path input to a canonical absolute path.
 * Accepts: full absolute paths, bare project names (no leading slash).
 * When rootPath is provided, bare names are placed under that root.
 */
export const normalizeProjectPath = (
	projectPath: string,
	rootPath = "",
): string => {
	const root = rootPath.replace(/\/+$/, "");
	const normalized = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");

	// Empty input → return the configured root or "/"
	if (!normalized) return root || "/";

	// Already under configured root (exact match or prefix)
	if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
		return normalized;
	}

	// Bare name without leading slash → place under configured root
	if (!normalized.startsWith("/")) {
		return root ? `${root}/${normalized}` : `/${normalized}`;
	}

	// Absolute path → return as-is
	return normalized;
};

/** The composition HTML file inside a project directory. */
export const compositionFile = (projectPath: string, rootPath = ""): string =>
	`${normalizeProjectPath(projectPath, rootPath)}/index.html`;
