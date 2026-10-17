/**
 * The preview `hyperframes_show` puts in the chat: a pointer to the project,
 * not the composition. The chat reads `{path}/index.html` from Files when it
 * shows the preview, so the conversation, its saved copy and every later
 * request to the model carry a few bytes instead of the whole composition.
 *
 * Older messages carry the composition HTML itself; `parseHyperframesReference`
 * returns null for those and the preview renders the HTML as before.
 */
export interface HyperframesReference {
	kind: typeof HYPERFRAMES_REFERENCE_KIND;
	/** The project folder: its composition is `{path}/index.html`. */
	path: string;
	/** Which version of index.html was shown; see `hyperframesRevision`. */
	revision: string;
	width?: number;
	height?: number;
	/** Seconds. */
	duration?: number;
}

export const HYPERFRAMES_REFERENCE_KIND = "hyperframes-project";

export const HYPERFRAMES_RENDERS_FOLDER = "renders";

/** FNV-1a over the UTF-16 code units: enough to tell versions apart. */
export const hyperframesRevision = (html: string): string => {
	let hash = 0x811c9dc5;
	for (let index = 0; index < html.length; index++) {
		hash ^= html.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${(hash >>> 0).toString(16).padStart(8, "0")}-${html.length.toString(36)}`;
};

const positiveNumber = (value: string | undefined): number | undefined => {
	const parsed = Number.parseFloat(value ?? "");
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** The root composition's size and length, as its data attributes give them. */
export const hyperframesCompositionInfo = (
	html: string,
): { width?: number; height?: number; duration?: number } => {
	const root =
		/<[a-z][^>]*\bdata-composition-id\s*=\s*["'][^"']*["'][^>]*>/i.exec(
			html,
		)?.[0];
	if (!root) return {};
	const attr = (name: string) =>
		new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(root)?.[1];
	return {
		width: positiveNumber(attr("data-width")),
		height: positiveNumber(attr("data-height")),
		duration: positiveNumber(attr("data-duration")),
	};
};

export const createHyperframesReference = (
	path: string,
	html: string,
): HyperframesReference => ({
	kind: HYPERFRAMES_REFERENCE_KIND,
	path,
	revision: hyperframesRevision(html),
	...hyperframesCompositionInfo(html),
});

export const serializeHyperframesReference = (
	reference: HyperframesReference,
): string => JSON.stringify(reference);

export const parseHyperframesReference = (
	content: string,
): HyperframesReference | null => {
	const trimmed = content.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		const value = JSON.parse(trimmed) as Partial<HyperframesReference>;
		if (
			value?.kind !== HYPERFRAMES_REFERENCE_KIND ||
			typeof value.path !== "string" ||
			!value.path.trim()
		) {
			return null;
		}
		const size = (n: unknown) =>
			typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
		return {
			kind: HYPERFRAMES_REFERENCE_KIND,
			path: value.path,
			revision: typeof value.revision === "string" ? value.revision : "",
			width: size(value.width),
			height: size(value.height),
			duration: size(value.duration),
		};
	} catch {
		return null;
	}
};

/** A HyperFrames composition: the markers `hyperframes_list` looks for. */
export const isHyperframesComposition = (html: string): boolean =>
	html.includes("data-composition-id") && html.includes("window.__timelines");

/** File-name-safe base for a project's renders, from its folder name. */
export const hyperframesRenderBase = (projectPath: string): string => {
	const name = projectPath.split("/").filter(Boolean).pop() ?? "";
	const cleaned = name
		.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
	return cleaned || "hyperframes-composition";
};

/** Where an MP4 rendered from a project is saved: `{project}/renders/{name}.mp4`. */
export const hyperframesRenderPath = (projectPath: string): string =>
	`${projectPath.replace(/\/+$/, "")}/${HYPERFRAMES_RENDERS_FOLDER}/${hyperframesRenderBase(projectPath)}.mp4`;
