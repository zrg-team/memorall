/** How a text file can be shown rendered to the user. */
export type MemonTextPreviewKind = "markdown" | "html" | "svg" | "csv" | "tsv";

const PREVIEW_KINDS: Record<string, MemonTextPreviewKind> = {
	md: "markdown",
	markdown: "markdown",
	html: "html",
	htm: "html",
	svg: "svg",
	csv: "csv",
	tsv: "tsv",
};

/** The rendered view a text file has, if any; the agent reads the text. */
export const textPreviewKind = (
	path: string | null,
): MemonTextPreviewKind | null =>
	path
		? (PREVIEW_KINDS[/\.([^./]+)$/.exec(path.toLowerCase())?.[1] ?? ""] ?? null)
		: null;

/**
 * Rows of a CSV or TSV text: quoted cells may hold delimiters, line breaks
 * and doubled quotes. A trailing line break adds no empty row.
 */
export const parseDelimited = (text: string, delimiter: string): string[][] => {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quoted) {
			if (char !== '"') cell += char;
			else if (text[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else quoted = false;
		} else if (char === '"' && cell === "") {
			quoted = true;
		} else if (char === delimiter) {
			row.push(cell);
			cell = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && text[index + 1] === "\n") index += 1;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else {
			cell += char;
		}
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
};
