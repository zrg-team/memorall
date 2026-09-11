import type { OpenUITheme } from "@/services/flows-integrations/steps/features/visualize-response/index";

// Theme is the 4th positional arg in: CardBlock("title", "desc", [...], "theme")
export const THEME_PATTERN = /\bCardBlock\s*\([\s\S]*?\]\s*,\s*"([^"]+)"\s*\)/;

const KNOWN_THEMES = new Set<OpenUITheme>(["shadcn", "wireframe", "glass"]);

export const isKnownOpenUITheme = (value: unknown): value is OpenUITheme =>
	typeof value === "string" && KNOWN_THEMES.has(value as OpenUITheme);

/**
 * The theme to render a block in.
 *
 * The model is told which theme the agent is configured for and asked to pass it
 * as the fourth argument to the root `CardBlock`. It does not always remember,
 * and when it forgets the agent's theme used to be lost silently — every such
 * block fell back to shadcn however the agent was configured. The configured
 * theme is now the fallback, so forgetting the argument costs nothing.
 */
export function detectTheme(
	content: string,
	configuredTheme?: OpenUITheme | string,
): OpenUITheme {
	const match = THEME_PATTERN.exec(content);
	if (match) {
		const theme = match[1] as OpenUITheme;
		if (KNOWN_THEMES.has(theme)) return theme;
	}
	return isKnownOpenUITheme(configuredTheme) ? configuredTheme : "shadcn";
}
