/** Strip trailing slashes for consistent path handling. */
const normalize = (p: string): string => p.trim().replace(/\/+$/, "");

/** The composition HTML file inside a project directory. */
export const compositionFile = (projectPath: string): string =>
	`${normalize(projectPath)}/index.html`;
