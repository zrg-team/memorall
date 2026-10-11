import type { IndexedFileInfo } from "../types";
import type { FileContentSummary } from "./concept";
import {
	frontmatterString,
	frontmatterTags,
	parseOkfDocument,
} from "./frontmatter";

/**
 * What a card says about a file, read from the file itself. Plain text and
 * markdown are read directly; PDFs and spreadsheets through the same readers
 * the file tools use, loaded only when such a file is met.
 */

/** Characters of text kept on a card. */
export const EXCERPT_CHARS = 1_500;
/** Text files larger than this are summarised from their start only. */
const TEXT_READ_BYTES = 256 * 1024;

const sentenceOf = (text: string, max = 240): string | undefined => {
	const flat = text
		.replace(/^#+\s+/gm, "")
		.replace(/[*_`>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!flat) return undefined;
	const sentence = /^(.{20,}?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
	return sentence.length > max
		? `${sentence.slice(0, max - 1).trimEnd()}…`
		: sentence;
};

const excerptOf = (text: string): string | undefined => {
	const trimmed = text
		.replace(/\r\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	if (!trimmed) return undefined;
	return trimmed.length > EXCERPT_CHARS
		? `${trimmed.slice(0, EXCERPT_CHARS).trimEnd()}…`
		: trimmed;
};

/** Most links kept from one file. */
const MAX_LINKS = 50;

const resolveLibraryPath = (
	href: string,
	fromFolder: string,
): string | null => {
	const parts = (href.startsWith("/") ? href : `${fromFolder}/${href}`)
		.split("/")
		.filter((part) => part && part !== ".");
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "..") {
			if (!resolved.length) return null;
			resolved.pop();
		} else resolved.push(part);
	}
	return resolved.length ? `/${resolved.join("/")}` : null;
};

/**
 * Targets of the markdown links in some text, images left out. A target with
 * spaces is written in angle brackets: `[a](<my notes.md>)`.
 */
export const markdownLinkTargets = (text: string): string[] =>
	[...text.matchAll(/(!?)\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))[^)]*\)/g)]
		.filter((match) => !match[1])
		.map((match) => (match[2] ?? match[3]).trim())
		.filter(Boolean);

/**
 * Library paths of the files a markdown file links to. Web and mail links,
 * anchors and images are left out; a link is resolved from the file's folder,
 * or from the library root when it starts with "/".
 */
export const extractMarkdownLinks = (
	text: string,
	filePath: string,
): string[] => {
	const folder = filePath.slice(0, filePath.lastIndexOf("/")) || "/";
	const links = new Set<string>();
	for (const raw of markdownLinkTargets(text)) {
		if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) continue;
		let href = raw.split(/[#?]/)[0];
		try {
			href = decodeURI(href);
		} catch {
			// Keep it as written.
		}
		const resolved = href ? resolveLibraryPath(href, folder) : null;
		if (resolved && resolved !== filePath) links.add(resolved);
		if (links.size >= MAX_LINKS) break;
	}
	return [...links];
};

/** Markdown and plain text: a file's own OKF frontmatter wins, else its first heading and sentence. */
export const summarizeText = (
	text: string,
	markdown: boolean,
	filePath?: string,
): FileContentSummary => {
	const { frontmatter, body } = markdown
		? parseOkfDocument(text)
		: { frontmatter: {}, body: text };
	const heading = markdown ? /^#\s+(.+)$/m.exec(body)?.[1]?.trim() : undefined;
	const firstParagraph = body
		.split(/\n\s*\n/)
		.map((block) => block.trim())
		.find((block) => block && !block.startsWith("#"));
	const tags = frontmatterTags(frontmatter);
	return {
		title: frontmatterString(frontmatter, "title") ?? heading,
		description:
			frontmatterString(frontmatter, "description") ??
			sentenceOf(firstParagraph ?? body),
		type: frontmatterString(frontmatter, "type"),
		tags: tags.length ? tags : undefined,
		excerpt: excerptOf(body),
		facts: [`Lines: ${text.split("\n").length}`],
		links:
			markdown && filePath ? extractMarkdownLinks(body, filePath) : undefined,
	};
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const summarizePdf = async (bytes: Uint8Array): Promise<FileContentSummary> => {
	const { readPDFFile } = await import(
		"@/main/modules/files/handlers/pdf-extraction"
	);
	const pdf = await readPDFFile(toArrayBuffer(bytes));
	const firstText = pdf.pages.find((page) => page.text.trim())?.text ?? "";
	return {
		title: pdf.title?.trim() || undefined,
		description: pdf.subject?.trim() || sentenceOf(firstText),
		excerpt: excerptOf(pdf.fullText || firstText),
		facts: [
			`Pages: ${pdf.numPages}`,
			...(pdf.author?.trim() ? [`Author: ${pdf.author.trim()}`] : []),
		],
	};
};

const summarizeSpreadsheet = async (
	bytes: Uint8Array,
): Promise<FileContentSummary> => {
	const { parseExcelFile, sheetToCsv } = await import(
		"@/main/modules/files/handlers/excel-extraction"
	);
	const workbook = await parseExcelFile(bytes);
	const sheets = workbook.SheetNames;
	const first = sheets[0] ? sheetToCsv(workbook, sheets[0]) : "";
	const rows = first
		? first.split("\n").filter((line) => line.trim()).length
		: 0;
	return {
		description: `Spreadsheet with ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}: ${sheets.slice(0, 5).join(", ")}${sheets.length > 5 ? ", …" : ""}.`,
		excerpt: excerptOf(first),
		facts: [`Sheets: ${sheets.join(", ")}`, `Rows in first sheet: ${rows}`],
	};
};

const decodeText = (bytes: Uint8Array): string =>
	new TextDecoder("utf-8", { fatal: false }).decode(
		bytes.byteLength > TEXT_READ_BYTES
			? bytes.subarray(0, TEXT_READ_BYTES)
			: bytes,
	);

const TEXT_EXTENSIONS =
	/\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|css|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sh|sql|toml|ini|log)$/i;

/** Whether reading the file can say more than its name and size. */
export const isReadableForSummary = (file: IndexedFileInfo): boolean =>
	file.documentType === "pdf" ||
	file.documentType === "excel" ||
	file.documentType === "markdown" ||
	file.documentType === "text" ||
	TEXT_EXTENSIONS.test(file.name);

/**
 * Reads what can be read cheaply. A file that cannot be read still gets a
 * card from its name, type and size, so one broken file never stops a sync.
 */
export const summarizeFileContent = async (
	file: IndexedFileInfo,
	readBytes: () => Promise<Uint8Array>,
): Promise<FileContentSummary> => {
	if (!isReadableForSummary(file)) return {};
	try {
		const bytes = await readBytes();
		if (file.documentType === "pdf") return await summarizePdf(bytes);
		if (file.documentType === "excel") return await summarizeSpreadsheet(bytes);
		return summarizeText(
			decodeText(bytes),
			file.documentType === "markdown" || /\.(md|markdown)$/i.test(file.name),
			file.path,
		);
	} catch {
		return { facts: ["Content could not be read."] };
	}
};
