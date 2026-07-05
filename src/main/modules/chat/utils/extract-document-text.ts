import { readPDFFile } from "@/main/modules/files/handlers/pdf-extraction";
import {
	parseExcelFile,
	workbookToMarkdown,
} from "@/main/modules/files/handlers/excel-extraction";
import type { DocumentType } from "@/types/document-library";

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
	if (content.buffer instanceof ArrayBuffer) {
		return content.buffer.slice(
			content.byteOffset,
			content.byteOffset + content.byteLength,
		);
	}
	const copy = new Uint8Array(content.byteLength);
	copy.set(content);
	return copy.buffer;
}

/**
 * Extract readable text from a document stored in the document filesystem.
 * Returns null for binary types (e.g. raw images) that have no text representation.
 */
export async function extractDocumentText(
	fileType: DocumentType,
	content: Uint8Array,
): Promise<string | null> {
	if (fileType === "text" || fileType === "markdown" || fileType === "other") {
		return new TextDecoder().decode(content);
	}

	if (fileType === "pdf") {
		const pdfContent = await readPDFFile(toArrayBuffer(content));
		return (
			pdfContent.fullText || pdfContent.pages.map((p) => p.text).join("\n\n")
		);
	}

	if (fileType === "excel") {
		const workbook = await parseExcelFile(content);
		return workbookToMarkdown(workbook);
	}

	return null;
}

/**
 * Format extracted document text in the standard mention block format:
 * `path`
 * ```
 * content
 * ```
 * ---
 */
export function formatDocumentBlock(path: string, text: string): string {
	return `\`${path}\`\n\`\`\`\n${text.trimEnd()}\n\`\`\`\n---\n`;
}
