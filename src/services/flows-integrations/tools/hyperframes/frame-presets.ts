import YAML from "yaml";

/**
 * HyperFrames design specs. `design.md` describes the brand (web-first);
 * `frame.md` directs the composition: the same brand reframed with the video
 * frame as the unit. Both are YAML frontmatter (normative tokens: colors,
 * typography, spacing, components) plus prose (intent, frame treatments,
 * Do's and Don'ts). A project reads the first that exists:
 * frame.md → design.md → DESIGN.md.
 *
 * The presets are HyperFrames' own frame.md files (hyperframes.dev/design),
 * bundled in frame-presets.generated.ts.
 */

export interface FramePresetInfo {
	slug: string;
	name: string;
	/** The look, in a line. */
	look: string;
	/** When to pick it. */
	pickWhen: string;
}

export const HYPERFRAMES_FRAME_PRESETS = [
	{
		slug: "biennale-yellow",
		name: "Biennale Yellow",
		look: "warm parchment, solar-yellow blooms, indigo ink, Instrument Serif display, 1px hairlines",
		pickWhen: "confident, atmospheric, museum-catalogue elegance",
	},
	{
		slug: "blockframe",
		name: "BlockFrame",
		look: "maximalist neobrutalist: thick black borders, hard offset shadows, candy pastels",
		pickWhen: "bold, punchy, playful-loud",
	},
	{
		slug: "blue-professional",
		name: "Blue Professional",
		look: "corporate cream with one cobalt accent, Space Grotesk + Inter, soft tinted cards",
		pickWhen: "measured, executive, investment-research rigor",
	},
	{
		slug: "bold-poster",
		name: "Bold Poster",
		look: "tilted Shrikhand display, tomato red on cream, Libre Baskerville body, double-border grids",
		pickWhen: "printed, powerful, vintage editorial gravitas",
	},
	{
		slug: "broadside",
		name: "Broadside",
		look: "industrial newsprint poster: ink and fire-orange, massive lowercase Barlow 900",
		pickWhen: "bold, typographic, declarative",
	},
	{
		slug: "capsule",
		name: "Capsule",
		look: "every container a pill, cream paper, candy palette, Bodoni Moda headlines",
		pickWhen: "friendly, soft, warm editorial",
	},
	{
		slug: "cartesian",
		name: "Cartesian",
		look: "sparse museum catalog: warm stone, Playfair Display, taupe hairline grid",
		pickWhen: "quiet authority, literary restraint",
	},
	{
		slug: "cobalt-grid",
		name: "Cobalt Grid",
		look: "two-color risograph: cream paper, cobalt ink graph grid, Newsreader + Hanken Grotesk",
		pickWhen: "systemic, editorial clarity",
	},
	{
		slug: "code-editorial",
		name: "Code Editorial",
		look: "warm cream brand book, terracotta coral accent, EB Garamond, navy code surface",
		pickWhen: "developer launches, code changes, docs with editorial calm",
	},
	{
		slug: "coral",
		name: "Coral",
		look: "coral, ink and cream at hard edges, Bebas Neue caps, diagonal hatch, giant numerals",
		pickWhen: "graphic, structuralist magazine confidence",
	},
	{
		slug: "creative-mode",
		name: "Creative Mode",
		look: "neo-brutalist cream, 4px ink borders, Archivo Black caps, JetBrains Mono data",
		pickWhen: "sparse but punchy, geometric presence",
	},
	{
		slug: "daisy-days",
		name: "Daisy Days",
		look: "sunny-garden pastels, charcoal outlines, hard shadows, Fredoka One + Quicksand, doodles",
		pickWhen: "playful, childlike, sticker-sheet warmth",
	},
	{
		slug: "editorial-forest",
		name: "Editorial Forest",
		look: "green, pink and cream triad, Source Serif 4 display, JetBrains Mono chrome",
		pickWhen: "spacious, literary, quiet confidence",
	},
] as const satisfies readonly FramePresetInfo[];

export type FramePresetSlug =
	(typeof HYPERFRAMES_FRAME_PRESETS)[number]["slug"];

export const HYPERFRAMES_FRAME_PRESET_SLUGS = HYPERFRAMES_FRAME_PRESETS.map(
	(preset) => preset.slug,
) as [FramePresetSlug, ...FramePresetSlug[]];

/** A preset's FRAME.md, loaded on demand (the files are ~230 KB together). */
export const loadFramePreset = async (slug: string): Promise<string | null> => {
	const { HYPERFRAMES_FRAME_PRESET_FILES } = await import(
		"./frame-presets.generated"
	);
	return HYPERFRAMES_FRAME_PRESET_FILES[slug] ?? null;
};

/** The spec files a project reads, the first that exists winning. */
export const DESIGN_SPEC_FILES = [
	"frame.md",
	"design.md",
	"DESIGN.md",
] as const;

export interface DesignSpec {
	frontmatter: Record<string, unknown>;
	body: string;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Specs are hand-written and not always strict YAML (`body-lede:{ … }`, with
 * no space after the colon, is common): the colors and typography sections
 * are read line by line when the YAML parser gives up.
 */
const looseFrontmatter = (source: string): Record<string, unknown> => {
	const sections: Record<string, Record<string, unknown>> = {};
	let current: Record<string, unknown> | null = null;
	for (const line of source.split(/\r?\n/)) {
		const top = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
		if (top) {
			current = top[2]?.trim() ? null : {};
			if (current) sections[top[1] as string] = current;
			continue;
		}
		const entry = /^\s+([\w-]+)\s*:\s*(.+)$/.exec(line);
		if (!current || !entry) continue;
		const [, key, raw] = entry as unknown as [string, string, string];
		const value = raw.trim();
		const family = /fontFamily\s*:\s*["']([^"']+)["']/.exec(value)?.[1];
		current[key] = family
			? { fontFamily: family }
			: value.replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
	}
	return sections;
};

export const parseDesignSpec = (markdown: string): DesignSpec => {
	const match = FRONTMATTER.exec(markdown);
	if (!match) return { frontmatter: {}, body: markdown };
	const source = (match[1] ?? "").replace(/^(\s*[\w-]+):(?=[{[])/gm, "$1: ");
	let frontmatter: Record<string, unknown>;
	try {
		const parsed = YAML.parse(source);
		frontmatter =
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: looseFrontmatter(source);
	} catch {
		frontmatter = looseFrontmatter(source);
	}
	return { frontmatter, body: markdown.slice(match[0].length) };
};

export interface DesignTokens {
	/** Color tokens by name, as written. */
	colors: Record<string, string>;
	fonts: { display?: string; body?: string; data?: string };
	/** Every font family the typography names. */
	families: string[];
}

const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

export const designTokens = (spec: DesignSpec): DesignTokens => {
	const colors: Record<string, string> = {};
	const rawColors = spec.frontmatter.colors;
	if (rawColors && typeof rawColors === "object") {
		for (const [name, value] of Object.entries(rawColors)) {
			if (typeof value === "string" && COLOR_VALUE.test(value.trim())) {
				colors[name] = value.trim();
			}
		}
	}
	const families: string[] = [];
	const roles: DesignTokens["fonts"] = {};
	// The display face is the one the biggest type token uses (sizes in cqw,
	// or px on a 1920-wide frame).
	let largest = { family: undefined as string | undefined, size: 0 };
	const typography = spec.frontmatter.typography;
	if (typography && typeof typography === "object") {
		for (const [name, value] of Object.entries(typography)) {
			const entry =
				value && typeof value === "object"
					? (value as { fontFamily?: unknown; cqw?: unknown; px?: unknown })
					: undefined;
			const family = entry?.fontFamily;
			if (typeof family !== "string" || !family.trim()) continue;
			const clean = family.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
			if (!clean) continue;
			if (!families.includes(clean)) families.push(clean);
			const size =
				Number(entry?.cqw) ||
				(Number(entry?.px) ? Number(entry?.px) / 19.2 : 0);
			if (size > largest.size) largest = { family: clean, size };
			const key = name.toLowerCase();
			if (!roles.data && /mono|data|code|pagenum|index/.test(key)) {
				roles.data = clean;
			} else if (
				!roles.display &&
				/display|headline|hero|title|numeral/.test(key)
			) {
				roles.display = clean;
			} else if (
				!roles.body &&
				/body|lede|reading|text|copy|paragraph/.test(key)
			) {
				roles.body = clean;
			}
		}
	}
	if (largest.family) roles.display = largest.family;
	roles.display ??= families[0];
	roles.body ??=
		families.find((family) => family !== roles.display) ?? roles.display;
	roles.data ??=
		families.find((family) => /mono|code/i.test(family)) ?? roles.body;
	return { colors, fonts: roles, families };
};

const hexRgb = (value: string): [number, number, number] | null => {
	let hex = value.trim().replace(/^#/, "");
	if (!/^[0-9a-f]+$/i.test(hex)) return null;
	if (hex.length === 3 || hex.length === 4) {
		hex = [...hex.slice(0, 3)].map((char) => char + char).join("");
	}
	if (hex.length !== 6 && hex.length !== 8) return null;
	return [0, 2, 4].map((index) =>
		Number.parseInt(hex.slice(index, index + 2), 16),
	) as [number, number, number];
};

/** Lowercase 6-digit hex, alpha dropped; null for non-hex colors. */
export const normalizeHex = (value: string): string | null => {
	const rgb = hexRgb(value);
	return rgb
		? `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`
		: null;
};

const luminance = ([r, g, b]: [number, number, number]) =>
	(0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const saturation = ([r, g, b]: [number, number, number]) => {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	return max === 0 ? 0 : (max - min) / max;
};

const byName = (
	colors: Record<string, string>,
	names: RegExp,
	exclude: Set<string>,
): string | undefined =>
	Object.keys(colors).find((name) => !exclude.has(name) && names.test(name));

/**
 * The runner's semantic theme (`--bg`, `--ink`, `--accent`, `--accent2`,
 * `--muted`, `--font-*`) mapped from a spec's tokens, by token name first
 * (paper, ink, accent, …) and by lightness and saturation after that.
 */
export const themeFromTokens = (tokens: DesignTokens) => {
	const { colors } = tokens;
	const used = new Set<string>();
	const rgb = (name: string) => hexRgb(colors[name] ?? "");
	const pick = (names: RegExp, fallback: (name: string) => number) => {
		const named = byName(colors, names, used);
		const name =
			named ??
			Object.keys(colors)
				.filter((candidate) => !used.has(candidate) && rgb(candidate))
				.sort((a, b) => fallback(b) - fallback(a))[0];
		if (name) used.add(name);
		return name;
	};
	const bg = pick(
		/^(paper|canvas|cream|ground|background|bg|surface|page|base|white)$/i,
		(name) => luminance(rgb(name) ?? [0, 0, 0]),
	);
	const ink = pick(
		/^(ink|text|foreground|fg|charcoal|black|body)$/i,
		(name) => 1 - luminance(rgb(name) ?? [255, 255, 255]),
	);
	const accent = pick(
		/^(accent|primary|brand|sun|coral|cobalt|fire|red|tomato|terracotta|pink|orange)$/i,
		(name) => saturation(rgb(name) ?? [0, 0, 0]),
	);
	const accent2 = pick(/^(accent-?2|secondary|highlight)$/i, (name) =>
		saturation(rgb(name) ?? [0, 0, 0]),
	);
	const muted = pick(
		/^(muted|gray|grey|taupe|subtle|stone|mid)$/i,
		(name) => 1 - saturation(rgb(name) ?? [255, 0, 0]),
	);
	const value = (name: string | undefined, fallback: string) =>
		(name && colors[name]) || fallback;
	const font = (family: string | undefined, generic: string) =>
		family ? `"${family}", ${generic}` : generic;
	return {
		bg: value(bg, "#0a0a0d"),
		ink: value(ink, "#f5f5f7"),
		accent: value(accent, "#7c6cff"),
		accent2: value(accent2, value(accent, "#7c6cff")),
		muted: value(muted, value(ink, "#8a8a95")),
		fontDisplay: font(tokens.fonts.display, "sans-serif"),
		fontBody: font(tokens.fonts.body, "sans-serif"),
		fontData: font(tokens.fonts.data, "monospace"),
	};
};

/**
 * A `:root` block that themes a scaffold from a spec: the semantic variables
 * the templates and `hf-*` utilities read, plus every color token verbatim as
 * `--c-<name>`.
 */
export const designRootCss = (tokens: DesignTokens): string => {
	const theme = themeFromTokens(tokens);
	const palette = Object.entries(tokens.colors)
		.map(([name, value]) => `--c-${name.replace(/[^\w-]/g, "-")}:${value}`)
		.join(";");
	return `:root{--bg:${theme.bg};--ink:${theme.ink};--accent:${theme.accent};--accent2:${theme.accent2};--muted:${theme.muted};--font-display:${theme.fontDisplay};--font-body:${theme.fontBody};--font-data:${theme.fontData}${palette ? `;${palette}` : ""}}`;
};
