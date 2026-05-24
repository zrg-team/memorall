import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { readPDFFile } from "@/main/modules/documents/handlers/pdf-extraction";
import { formatPDFAsText, formatPDFAsMarkdown } from "@/lib/pdf-utils";
import { normalizeDocumentPath } from "./util";
import { ensureFolderExists } from "../../utils/document-fs-utils";
import { pathExists, readFileBytes, writeFileBytes } from "../fs/util";

const TOOL_NAME = "pdf_to_text" as const;

const schema = z.object({
	source_path: z
		.string()
		.describe("Path to the PDF file in /documents. Must end with .pdf."),
	output_path: z
		.string()
		.optional()
		.describe(
			"Optional path to save the extracted text in /documents. If omitted, the text is returned directly.",
		),
	format: z
		.enum(["text", "markdown"])
		.optional()
		.describe(
			"Output format: `text` (default) for plain text with page separators, `markdown` for Markdown with frontmatter and headings.",
		),
	page_range: z
		.object({
			start: z.number().describe("First page to extract (1-based)."),
			end: z.number().describe("Last page to extract (1-based, inclusive)."),
		})
		.optional()
		.describe("Optional page range to extract. Defaults to all pages."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

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

export const createPdfToTextTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Extract text from a PDF file in /documents and return it or save it to a new file. Supports plain text or Markdown output and optional page range extraction.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) {
			return "PDF text extraction error: Document filesystem service is not available.";
		}

		const sourcePath = normalizeDocumentPath(input.source_path);
		if (!sourcePath.toLowerCase().endsWith(".pdf")) {
			return `PDF text extraction error: source_path must end with .pdf, got: ${input.source_path}`;
		}

		try {
			if (!(await pathExists(dfs, sourcePath))) {
				return `PDF text extraction error: File not found: ${input.source_path}`;
			}

			const content = await readFileBytes(dfs, sourcePath);
			const pdfData = await readPDFFile(toArrayBuffer(content));

			const fmt = input.format ?? "text";
			let extractedText: string;

			if (input.page_range) {
				const { start, end } = input.page_range;
				const actualStart = Math.max(1, start);
				const actualEnd = Math.min(pdfData.numPages, end);
				const pages = pdfData.pages.filter(
					(p) => p.pageNumber >= actualStart && p.pageNumber <= actualEnd,
				);
				extractedText = pages.map((p) => p.text).join("\n\n");
			} else {
				extractedText =
					fmt === "markdown"
						? formatPDFAsMarkdown(pdfData)
						: formatPDFAsText(pdfData);
			}

			if (!input.output_path) {
				const pageRangeText = input.page_range
					? `Pages: ${Math.max(1, input.page_range.start)}-${Math.min(pdfData.numPages, input.page_range.end)}`
					: `Pages: 1-${pdfData.numPages}`;

				return [
					"PDF text extraction",
					`Source: ${sourcePath}`,
					`Total pages: ${pdfData.numPages}`,
					pageRangeText,
					`Format: ${fmt}`,
					"",
					extractedText,
				].join("\n");
			}

			// Save to output_path
			const outputPath = normalizeDocumentPath(input.output_path);
			const lastSlash = outputPath.lastIndexOf("/");
			const parentPath =
				lastSlash > 0 ? outputPath.substring(0, lastSlash) : "/";
			const fileName = outputPath.substring(lastSlash + 1);

			if (!fileName) {
				return "PDF text extraction error: Invalid output_path - no filename provided.";
			}

			await ensureFolderExists(dfs, parentPath);
			await writeFileBytes(dfs, outputPath, extractedText);

			return [
				"PDF text extraction saved",
				`Source: ${sourcePath}`,
				`Output: ${outputPath}`,
				`Total pages: ${pdfData.numPages}`,
				`Format: ${fmt}`,
				`Characters: ${extractedText.length}`,
			].join("\n");
		} catch (error) {
			return `PDF text extraction error: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createPdfToTextTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
