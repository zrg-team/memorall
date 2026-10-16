import {
	CANONICAL_FONT_DISPLAY_NAMES,
	FONT_ALIAS_MAP,
} from "@hyperframes/parsers/composition";
import fontCatalog from "./font-catalog.json";

/** Families Memorall packages for the design presets (see font-catalog.json). */
export const HYPERFRAMES_CATALOG_FONTS: readonly string[] = Object.keys(
	fontCatalog.families,
);

/**
 * The fonts a composition can name and get, in its preview and its MP4: the
 * families HyperFrames embeds (Inter, Montserrat, Oswald, JetBrains Mono, ...),
 * the names it maps onto them (Helvetica, Arial, SF Pro, ...), and the
 * families the design presets use (Instrument Serif, Space Grotesk, ...). Any
 * other family falls back to a generic font.
 */
export const HYPERFRAMES_BUNDLED_FONTS: readonly string[] = [
	...Object.values(CANONICAL_FONT_DISPLAY_NAMES),
	...HYPERFRAMES_CATALOG_FONTS,
];

const CATALOG_KEYS = new Map(
	HYPERFRAMES_CATALOG_FONTS.map((family) => [family.toLowerCase(), family]),
);

/** One face of a packaged catalog font: public/vendors/hyperframes/fonts/manifest.json. */
export interface CatalogFontFace {
	weight: string;
	style: string;
	unicodeRange: string | null;
	file: string;
}

export type CatalogFontManifest = Record<string, CatalogFontFace[]>;

/** Where the packaged catalog fonts live, relative to the app's assets. */
export const HYPERFRAMES_FONT_ASSET_DIR = "vendors/hyperframes/fonts";

/** Reads the packaged catalog fonts: the manifest and each woff2 file. */
export interface CatalogFontLoader {
	manifest: () => Promise<CatalogFontManifest>;
	file: (file: string) => Promise<Uint8Array>;
}

// Families the browser always has: never replaced, never reported.
const GENERIC_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
	"ui-serif",
	"ui-sans-serif",
	"ui-monospace",
	"ui-rounded",
	"emoji",
	"math",
	"fangsong",
	"inherit",
	"initial",
	"unset",
	"revert",
	"-apple-system",
	"blinkmacsystemfont",
]);

// `font-family: ...` and custom properties that hold a family (`--font-display: ...`).
const FONT_DECLARATION =
	/(?:font-family|--[\w-]*font[\w-]*)\s*:\s*([^;{}<]+)/gi;
const FONT_FACE_BLOCK = /@font-face\s*\{([^}]*)\}/gi;
const FONT_FACE_FAMILY = /font-family\s*:\s*([^;}]+)/i;

const parseFamilies = (value: string): string[] =>
	value
		.split(",")
		.map((part) =>
			part
				.trim()
				.replace(/!important$/i, "")
				.trim()
				.replace(/^["']|["']$/g, "")
				.trim(),
		)
		// Not families: var() references, sizes and weights of a `font:` shorthand.
		.filter(
			(family) =>
				family &&
				!family.startsWith("var(") &&
				!/^[\d.]/.test(family) &&
				!/[()]/.test(family),
		);

const declaredFontFaceFamilies = (html: string): Set<string> => {
	const declared = new Set<string>();
	for (const block of html.matchAll(FONT_FACE_BLOCK)) {
		const family = FONT_FACE_FAMILY.exec(block[1] ?? "")?.[1];
		for (const name of parseFamilies(family ?? "")) {
			declared.add(name.toLowerCase());
		}
	}
	return declared;
};

/**
 * The font families a composition names and does not declare with
 * @font-face itself, as written; generic families left out.
 */
export const usedFontFamilies = (html: string): string[] => {
	const declared = declaredFontFaceFamilies(html);
	const families = new Map<string, string>();
	for (const match of html.matchAll(FONT_DECLARATION)) {
		for (const family of parseFamilies(match[1] ?? "")) {
			const key = family.toLowerCase();
			if (GENERIC_FAMILIES.has(key) || declared.has(key)) continue;
			if (!families.has(key)) families.set(key, family);
		}
	}
	return [...families.values()];
};

/** The font HyperFrames embeds for a family (its slug), or undefined. */
export const bundledFontFor = (family: string): string | undefined =>
	(FONT_ALIAS_MAP as Record<string, string>)[family.toLowerCase()];

/** The packaged catalog family a name matches, or undefined. */
export const catalogFontFor = (family: string): string | undefined =>
	CATALOG_KEYS.get(family.toLowerCase());

/** Families a composition names that neither HyperFrames nor Memorall has a font for. */
export const unbundledFontFamilies = (html: string): string[] =>
	usedFontFamilies(html).filter(
		(family) => !bundledFontFor(family) && !catalogFontFor(family),
	);

const cssString = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

const fontFace = (
	family: string,
	src: string,
	weight: string,
	style: string,
	unicodeRange?: string | null,
) =>
	`@font-face{font-family:${cssString(family)};src:url("${src}") format("woff2");font-weight:${weight};font-style:${style};font-display:block${unicodeRange ? `;unicode-range:${unicodeRange}` : ""}}`;

const toBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
};

/**
 * `@font-face` rules that give the composition's fonts their faces as data
 * URLs, so the preview and every exported frame use the same faces on any
 * computer: HyperFrames' embedded fonts (and the aliases it maps onto them),
 * and, with `catalog`, the packaged design-preset fonts. Empty when the
 * composition names none of them.
 */
export const bundledFontFaces = async (
	html: string,
	catalog?: CatalogFontLoader,
): Promise<string> => {
	const used = usedFontFamilies(html);
	const embedded = used
		.map((family) => ({ family, slug: bundledFontFor(family) }))
		.filter(
			(entry): entry is { family: string; slug: string } =>
				typeof entry.slug === "string",
		);
	const packaged = catalog
		? used
				.map((family) => ({ family, name: catalogFontFor(family) }))
				.filter(
					(entry): entry is { family: string; name: string } =>
						typeof entry.name === "string",
				)
		: [];
	const rules: string[] = [];
	if (embedded.length > 0) {
		// ~1 MB of font data: loaded only by a composition that uses it.
		const { EMBEDDED_FONT_DATA } = await import(
			"@hyperframes/core/fonts/embedded-data"
		);
		for (const { family, slug } of embedded) {
			const prefix = `@fontsource/${slug}:`;
			for (const [key, dataUrl] of EMBEDDED_FONT_DATA) {
				if (!key.startsWith(prefix)) continue;
				const [, weight = "400", style = "normal"] = key.split(":");
				rules.push(fontFace(family, dataUrl, weight, style));
			}
		}
	}
	if (catalog && packaged.length > 0) {
		const manifest = await catalog.manifest();
		for (const { family, name } of packaged) {
			for (const face of manifest[name] ?? []) {
				const bytes = await catalog.file(face.file);
				rules.push(
					fontFace(
						family,
						`data:font/woff2;base64,${toBase64(bytes)}`,
						face.weight,
						face.style,
						face.unicodeRange,
					),
				);
			}
		}
	}
	return rules.join("\n");
};
