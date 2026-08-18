import type { OpenUITheme } from "@/services/flows-integrations/steps/features/visualize-response/index";

// Theme is the 4th positional arg in: CardBlock("title", "desc", [...], "theme")
export const THEME_PATTERN = /\bCardBlock\s*\([\s\S]*?\]\s*,\s*"([^"]+)"\s*\)/;

const KNOWN_THEMES = new Set<OpenUITheme>(["shadcn", "wireframe", "glass"]);

export function detectTheme(content: string): OpenUITheme {
	const match = THEME_PATTERN.exec(content);
	if (match) {
		const theme = match[1] as OpenUITheme;
		if (KNOWN_THEMES.has(theme)) return theme;
	}
	return "shadcn";
}
