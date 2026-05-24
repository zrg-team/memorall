import z from "zod";
import * as pdfjsLib from "pdfjs-dist";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "./util";
import { pathExists, readFileBytes } from "../fs/util";

const TOOL_NAME = "pdf_metadata" as const;

if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
	pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
		"vendors/pdfjs/pdf.worker.min.mjs",
	);
} else {
	pdfjsLib.GlobalWorkerOptions.workerSrc = `/vendors/pdfjs/pdf.worker.min.mjs`;
}

const schema = z.object({
	source_path: z
		.string()
		.describe("Path to the PDF file in /documents. Must end with .pdf."),
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

const IMAGE_OPERATORS = new Set<number>([
	pdfjsLib.OPS.paintImageXObject,
	pdfjsLib.OPS.paintImageXObjectRepeat,
	pdfjsLib.OPS.paintInlineImageXObject,
	pdfjsLib.OPS.paintInlineImageXObjectGroup,
	pdfjsLib.OPS.paintImageMaskXObject,
	pdfjsLib.OPS.paintImageMaskXObjectRepeat,
]);

function formatValue(value: string | undefined): string {
	return value?.trim() || "Not available";
}

export const createPdfMetadataTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read PDF metadata from a file in /documents, including total pages and whether image content appears on each page.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) {
			return "PDF metadata error: Document filesystem service is not available.";
		}

		const sourcePath = normalizeDocumentPath(input.source_path);
		if (!sourcePath.toLowerCase().endsWith(".pdf")) {
			return `PDF metadata error: source_path must end with .pdf, got: ${input.source_path}`;
		}

		try {
			if (!(await pathExists(dfs, sourcePath))) {
				return `PDF metadata error: File not found: ${input.source_path}`;
			}

			const content = await readFileBytes(dfs, sourcePath);
			const loadingTask = pdfjsLib.getDocument({
				data: toArrayBuffer(content),
			});
			const pdf = await loadingTask.promise;
			const metadata = await pdf.getMetadata();
			const info = (metadata.info as Record<string, string>) || {};
			const pages: Array<{
				page: number;
				width: number;
				height: number;
				has_images: boolean;
				image_operator_count: number;
			}> = [];

			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
				const page = await pdf.getPage(pageNumber);
				const viewport = page.getViewport({ scale: 1 });
				const operatorList = await page.getOperatorList();
				const imageOperatorCount = operatorList.fnArray.filter((operator) =>
					IMAGE_OPERATORS.has(operator),
				).length;

				pages.push({
					page: pageNumber,
					width: viewport.width,
					height: viewport.height,
					has_images: imageOperatorCount > 0,
					image_operator_count: imageOperatorCount,
				});
			}

			const imagePages = pages
				.filter((page) => page.has_images)
				.map((page) => page.page);

			const pageLines = pages
				.map(
					(page) =>
						`- Page ${page.page}: ${Math.round(page.width)}x${Math.round(page.height)} pt, images: ${page.has_images ? "yes" : "no"} (${page.image_operator_count} image operators)`,
				)
				.join("\n");

			return [
				"PDF metadata",
				`Source: ${sourcePath}`,
				`Total pages: ${pdf.numPages}`,
				`Has images: ${imagePages.length > 0 ? "yes" : "no"}`,
				`Image pages: ${imagePages.length ? imagePages.join(", ") : "none"}`,
				`Image page count: ${imagePages.length}`,
				"",
				"Document info",
				`Title: ${formatValue(info.Title)}`,
				`Author: ${formatValue(info.Author)}`,
				`Subject: ${formatValue(info.Subject)}`,
				`Creator: ${formatValue(info.Creator)}`,
				`Producer: ${formatValue(info.Producer)}`,
				`Creation date: ${formatValue(info.CreationDate)}`,
				`Modification date: ${formatValue(info.ModDate)}`,
				"",
				"Pages",
				pageLines,
			].join("\n");
		} catch (error) {
			return `PDF metadata error: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createPdfMetadataTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
