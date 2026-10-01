import { strFromU8, unzipSync } from "fflate";

/**
 * Word (.docx) text as Markdown: headings, list items, paragraphs and tables
 * from `word/document.xml`. Formatting, images and comments are left out.
 * String-based so it runs where DOMParser does not (workers, tests).
 */

const DOCUMENT_XML = "word/document.xml";

const decodeXml = (text: string): string =>
	text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
			String.fromCodePoint(Number.parseInt(code, 16)),
		)
		.replace(/&#(\d+);/g, (_, code: string) =>
			String.fromCodePoint(Number(code)),
		)
		.replace(/&amp;/g, "&");

/** The text of the runs in some XML: text, tabs and line breaks. */
const runText = (xml: string): string => {
	let text = "";
	for (const match of xml.matchAll(
		/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g,
	)) {
		if (match[1] !== undefined) text += decodeXml(match[1]);
		else text += match[0].startsWith("<w:tab") ? "\t" : "\n";
	}
	return text;
};

const paragraphMarkdown = (xml: string): string => {
	const text = runText(xml).trim();
	if (!text) return "";
	const style = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? "";
	const level =
		/^heading\s?(\d)$/i.exec(style)?.[1] ?? (style === "Title" ? "1" : null);
	if (level) return `${"#".repeat(Math.min(6, Number(level)))} ${text}`;
	if (xml.includes("<w:numPr>") || /list/i.test(style)) return `- ${text}`;
	return text;
};

const tableMarkdown = (xml: string): string => {
	const rows = [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
		[...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
			[...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
				.map((paragraph) => runText(paragraph[0]).trim())
				.filter(Boolean)
				.join(" ")
				.replace(/\|/g, "\\|")
				.replace(/\s*\n\s*/g, " "),
		),
	);
	const width = Math.max(0, ...rows.map((row) => row.length));
	if (!width) return "";
	const line = (cells: string[]) =>
		`| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
	const [header, ...body] = rows;
	return [
		line(header ?? []),
		`| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
		...body.map(line),
	].join("\n");
};

/** Markdown from a .docx file's bytes; throws when it is not one. */
export function docxToMarkdown(bytes: Uint8Array): string {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => file.name === DOCUMENT_XML,
		});
	} catch {
		throw new Error("This is not a Word document (.docx).");
	}
	const document = files[DOCUMENT_XML];
	if (!document) throw new Error("This is not a Word document (.docx).");
	const xml = strFromU8(document);
	const blocks: string[] = [];
	for (const match of xml.matchAll(
		/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g,
	)) {
		const block = match[0].startsWith("<w:tbl>")
			? tableMarkdown(match[0])
			: paragraphMarkdown(match[0]);
		if (block) blocks.push(block);
	}
	// Keep consecutive list items together.
	return blocks
		.reduce<string[]>((out, block) => {
			const previous = out[out.length - 1];
			if (previous?.startsWith("- ") && block.startsWith("- ")) {
				out[out.length - 1] = `${previous}\n${block}`;
			} else {
				out.push(block);
			}
			return out;
		}, [])
		.join("\n\n");
}
