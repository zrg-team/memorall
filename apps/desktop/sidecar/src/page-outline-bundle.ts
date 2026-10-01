import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BrowserAutomationError } from "./browser-runtime-types";

/**
 * The page-outline bundle (`src/co-agent/host/page-outline-entry.ts`), built by
 * `tools/prepare-desktop-browser-runtime.mjs` and staged next to the sidecar's
 * own `index.mjs`, like the co-agent bundle.
 */
let bundle: string | null = null;

export const loadPageOutlineBundle = (): string => {
	if (bundle !== null) return bundle;
	try {
		bundle = readFileSync(
			fileURLToPath(new URL("./page-outline.js", import.meta.url)),
			"utf8",
		);
	} catch (error) {
		throw new BrowserAutomationError(
			"PAGE_OUTLINE_BUNDLE_MISSING",
			`The page outline bundle was not staged with the sidecar: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	return bundle;
};

/**
 * An expression that installs the outline API in the page when a navigation
 * has dropped it, then evaluates `call` against it. Evaluated per command
 * rather than injected once: refs live in the page's own window and must be
 * rebuilt for each new document anyway.
 */
export const pageOutlineExpression = (call: string): string =>
	`(async () => { if (!window.__memorallPageOutline) { ${loadPageOutlineBundle()}
} return await (${call}); })()`;

export const outlineBuildCall = (maxChars: number): string =>
	`window.__memorallPageOutline.build(${Math.max(500, Math.trunc(maxChars))})`;

export const outlineActCall = (
	request: Record<string, unknown>,
	maxChars: number,
): string =>
	`window.__memorallPageOutline.act(${JSON.stringify(request)}, ${Math.max(500, Math.trunc(maxChars))})`;

/** A click that navigates destroys the context the evaluation ran in. */
export const isNavigationTeardown = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error);
	return /context was destroyed|Cannot find context|Inspected target navigated|Target closed/i.test(
		message,
	);
};
