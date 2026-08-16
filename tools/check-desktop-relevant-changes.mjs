// Decides whether a pull request can affect the desktop application build.
//
// The desktop app is not self-contained: apps/desktop bundles shared src/,
// packages/agent-harness and public/, it is staged by tools/, and it is pinned
// by the root dependency manifests. Anything outside the inert list below is
// therefore treated as relevant, so a new directory runs the matrix instead of
// silently skipping it.
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const inertDirectories = [
	"apps/web/",
	"docs/",
	"e2e/extension/",
	"e2e/sandbox/",
	"e2e/web/",
	".vscode/",
];

const inertFiles = new Set([
	".env.example",
	".gitattributes",
	".gitignore",
	".github/workflows/agent-harness.yml",
	".prettierignore",
	"LICENSE",
	"extension.config.cjs",
	"manifest.base.json",
	"manifest.json",
	"playwright.extension.config.ts",
	"playwright.sandbox.config.ts",
	"playwright.web.config.ts",
]);

const isInert = (path) =>
	path.endsWith(".md") ||
	inertFiles.has(path) ||
	inertDirectories.some((directory) => path.startsWith(directory));

// An empty change set means the caller could not determine what moved (a manual
// dispatch, for example), which is not evidence that nothing did.
export const desktopBuildIsAffected = (paths) =>
	paths.length === 0 || paths.some((path) => !isInert(path));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const paths = process.argv
		.slice(2)
		.flatMap((argument) => argument.split(/\r?\n/))
		.map((path) => path.trim())
		.filter(Boolean);
	const affected = desktopBuildIsAffected(paths);
	const skipped = paths.filter(isInert).length;
	console.log(
		paths.length === 0
			? "Desktop matrix runs: no changed file list was supplied, so the build is assumed to be affected."
			: affected
				? `Desktop matrix runs: ${paths.length - skipped} of ${paths.length} changed file(s) can affect the desktop build.`
				: `Desktop matrix skipped: all ${paths.length} changed file(s) are documentation, web-only or other-platform files.`,
	);
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `desktop=${affected}\n`, "utf8");
	}
}
