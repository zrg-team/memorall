import type { DocumentType } from "@/types/document-library";
import { OKF_INDEXER_ACTOR } from "../constants";
import type { IndexedFileInfo } from "../types";
import {
	frontmatterString,
	type OkfDocument,
	type OkfFrontmatter,
	verificationEvents,
} from "./frontmatter";

/**
 * A file's card: one OKF concept describing one file in an indexed folder.
 * The card points at the file through `resource` (§4.1) and records the
 * version it was read from as a source (§5.1), so a changed file is found by
 * comparing the two, without reading it.
 */

/** URIs of library files: the card's `resource`. */
export const FILE_RESOURCE_SCHEME = "memorall-file://" as const;

export const fileResource = (path: string): string =>
	`${FILE_RESOURCE_SCHEME}${encodeURI(path)}`;

export const resourcePath = (resource: string): string | null => {
	if (!resource.startsWith(FILE_RESOURCE_SCHEME)) return null;
	try {
		return decodeURI(resource.slice(FILE_RESOURCE_SCHEME.length));
	} catch {
		return null;
	}
};

/** `sources[].id` of the file a card was read from. */
export const FILE_SOURCE_ID = "file" as const;

const DOCUMENT_TYPE_NAMES: Record<DocumentType, string> = {
	pdf: "PDF Document",
	text: "Text Document",
	markdown: "Markdown Document",
	image: "Image",
	audio: "Audio",
	video: "Video",
	excel: "Spreadsheet",
	presentation: "Presentation",
	other: "File",
};

export const conceptTypeForFile = (documentType: DocumentType): string =>
	DOCUMENT_TYPE_NAMES[documentType] ?? DOCUMENT_TYPE_NAMES.other;

/** What reading a file found, for its card. */
export interface FileContentSummary {
	/** One sentence for `description` and index.md. */
	description?: string;
	/** The start of the file's text, for search and for the card body. */
	excerpt?: string;
	/** Facts about the file, e.g. "Pages: 3". */
	facts?: string[];
	tags?: string[];
	title?: string;
	/** A concept type the file declares about itself (an OKF markdown file). */
	type?: string;
	/** Library paths of the files this file links to. */
	links?: string[];
}

export const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

const fileSource = (
	frontmatter: OkfFrontmatter,
): Record<string, unknown> | undefined => {
	const sources = frontmatter.sources;
	if (!Array.isArray(sources)) return undefined;
	return sources.find(
		(source): source is Record<string, unknown> =>
			Boolean(source) &&
			typeof source === "object" &&
			(source as { id?: unknown }).id === FILE_SOURCE_ID,
	);
};

const isoOf = (value: unknown): string | undefined => {
	if (value instanceof Date) return value.toISOString();
	if (typeof value !== "string") return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/** Whether the card was written from this version of the file. */
export const isCardCurrent = (
	card: OkfDocument | null,
	file: IndexedFileInfo,
): boolean => {
	if (!card) return false;
	const source = fileSource(card.frontmatter);
	return (
		Boolean(source) &&
		// Cards written before the indexer marked its part are written again.
		card.body.includes(INDEXER_START) &&
		isoOf(source?.last_modified) === isoOf(file.modifiedAt) &&
		card.frontmatter.file_size === file.size &&
		frontmatterString(card.frontmatter, "resource") === fileResource(file.path)
	);
};

/**
 * Whether a person wrote or confirmed the card. Their `type`, `title`,
 * `description` and `tags` are kept when the file changes.
 */
export const isCuratedCard = (frontmatter: OkfFrontmatter): boolean => {
	const generated = frontmatter.generated as { by?: unknown } | undefined;
	const by = typeof generated?.by === "string" ? generated.by : "";
	return (
		(by !== "" && by !== OKF_INDEXER_ACTOR) ||
		verificationEvents(frontmatter).some((event) =>
			event.by.startsWith("human:"),
		)
	);
};

const oneLine = (text: string, max: number): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

const titleOf = (file: IndexedFileInfo): string => file.name;

const fallbackDescription = (file: IndexedFileInfo): string =>
	`${conceptTypeForFile(file.documentType)}, ${formatBytes(file.size)}.`;

/**
 * The card for a file. Starts from the existing card so keys the indexer
 * does not own survive; a curated card keeps its descriptive fields.
 */
export const buildFileConcept = (
	file: IndexedFileInfo,
	summary: FileContentSummary,
	existing: OkfDocument | null,
	now: Date,
	/** The bundle root, so links can use bundle-relative paths (OKF §6.1). */
	root = "/",
): OkfDocument => {
	const previous = existing?.frontmatter ?? {};
	const curated = existing ? isCuratedCard(previous) : false;
	const describe = <T>(own: T | undefined, fromFile: T | undefined) =>
		curated && own !== undefined ? own : fromFile;

	const description = oneLine(
		summary.description || fallbackDescription(file),
		240,
	);
	const tags = summary.tags?.length ? summary.tags : undefined;
	const frontmatter: OkfFrontmatter = {
		...previous,
		type: describe(
			frontmatterString(previous, "type"),
			summary.type || conceptTypeForFile(file.documentType),
		),
		title: describe(
			frontmatterString(previous, "title"),
			summary.title || titleOf(file),
		),
		description: describe(
			frontmatterString(previous, "description"),
			description,
		),
		resource: fileResource(file.path),
		tags: describe(previous.tags as string[] | undefined, tags),
		generated: curated
			? previous.generated
			: { by: OKF_INDEXER_ACTOR, at: now.toISOString() },
		sources: [
			{
				id: FILE_SOURCE_ID,
				resource: fileResource(file.path),
				title: file.name,
				last_modified: isoOf(file.modifiedAt) ?? file.modifiedAt,
			},
		],
		file_size: file.size,
		media_type: file.mimeType || undefined,
	};

	const facts = [
		`Path: ${file.path}`,
		`Size: ${formatBytes(file.size)}`,
		`Modified: ${isoOf(file.modifiedAt) ?? file.modifiedAt}`,
		...(summary.facts ?? []),
	];
	const links = (summary.links ?? []).map((path) => linkLine(path, root));
	const body = [
		INDEXER_START,
		"# File",
		"",
		...facts.map((fact) => `- ${fact}`),
		...(summary.excerpt?.trim()
			? ["", "# Excerpt", "", fenced(summary.excerpt.trim())]
			: []),
		...(links.length ? ["", "# Links", "", ...links] : []),
		INDEXER_END,
		...keptSections(existing?.body ?? ""),
	].join("\n");
	return { frontmatter, body };
};

/**
 * The indexer's part of a card body, between these comments. Everything
 * outside them was added by a person or an agent and is kept on rebuild.
 */
export const INDEXER_START = "<!-- okf-indexer:start -->";
export const INDEXER_END = "<!-- okf-indexer:end -->";

/** The excerpt as a code block, so headings and links in the file stay text. */
const fenced = (text: string): string => {
	const longest = Math.max(
		2,
		...[...text.matchAll(/`+/g)].map((match) => match[0].length),
	);
	const fence = "`".repeat(longest + 1);
	return `${fence}text\n${text}\n${fence}`;
};

/** A link to another file's card: bundle-relative inside the bundle (OKF §6.1). */
const linkLine = (path: string, root: string): string => {
	const name = path.split("/").pop() ?? path;
	const base = root === "/" ? "" : root;
	const inside = root === "/" || path.startsWith(`${root}/`);
	const href = inside
		? `${encodeURI(path.slice(base.length))}.md`
		: fileResource(path);
	return `* [${name.replace(/[[\]\\]/g, "\\$&")}](${href})`;
};

export const keptSections = (body: string): string[] => {
	const start = body.indexOf(INDEXER_START);
	const end = body.indexOf(INDEXER_END);
	// A card from before the markers holds only what the indexer wrote.
	if (start === -1 || end === -1) return [];
	const kept =
		`${body.slice(0, start)}\n${body.slice(end + INDEXER_END.length)}`.split(
			/\r?\n/,
		);
	while (kept.length && !kept[0].trim()) kept.shift();
	while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
	return kept.length ? ["", ...kept] : [];
};
