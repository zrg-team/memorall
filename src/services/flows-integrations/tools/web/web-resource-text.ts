import type { WebResourceTextArgs } from "@memorall/agent-harness-flows/interfaces/services/web-browser";

const SPREADSHEET_TYPES = new Set([
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.oasis.opendocument.spreadsheet",
]);

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

/**
 * The readable text of a file a web tool downloaded, for the formats the app
 * can open: a PDF's pages, a spreadsheet's sheets. Null for anything else.
 *
 * The readers load on first use, since most runs never meet a PDF.
 */
export const readWebResourceText = async ({
	mimeType,
	bytes,
}: WebResourceTextArgs): Promise<string | null> => {
	const type = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (type === "application/pdf") {
		const [{ readPDFFile }, { formatPDFAsText }] = await Promise.all([
			import("@/main/modules/files/handlers/pdf-extraction"),
			import("@/lib/pdf-utils"),
		]);
		return formatPDFAsText(await readPDFFile(toArrayBuffer(bytes)));
	}
	if (SPREADSHEET_TYPES.has(type)) {
		const { parseExcelFile, workbookToMarkdown } = await import(
			"@/main/modules/files/handlers/excel-extraction"
		);
		return workbookToMarkdown(await parseExcelFile(bytes));
	}
	return null;
};
