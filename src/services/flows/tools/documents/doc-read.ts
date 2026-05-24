import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { readPDFFile } from "@/main/modules/documents/handlers/pdf-extraction";
import {
	parseExcelFile,
	workbookToMarkdown,
} from "@/main/modules/documents/handlers/excel-extraction";
import { normalizeDocumentPath } from "./util";
import { readFileBytes } from "../fs/util";

const TOOL_NAME = "doc_read" as const;

const schema = z.object({
	file_path: z.string().describe("Document path to read"),
	offset: z.number().optional().describe("Start line, 1-based (default: 1)"),
	limit: z.number().optional().describe("Max lines to return"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

type ReadableFileType = "pdf" | "excel" | "text";

function inferFileType(path: string): ReadableFileType {
	const lower = path.toLowerCase();
	if (lower.endsWith(".pdf")) return "pdf";
	if (
		lower.endsWith(".xls") ||
		lower.endsWith(".xlsx") ||
		lower.endsWith(".xlsm")
	) {
		return "excel";
	}
	return "text";
}

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

async function extractReadableText(
	fileType: ReadableFileType,
	content: Uint8Array,
): Promise<string | null> {
	if (fileType === "text") {
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

export const createDocReadTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read document file content with line numbers. Returns cat -n style output with a header showing total lines and range. Supports text/markdown/other and best-effort text extraction for PDF/Excel.",
	schema,
	execute: async (input) => {
		const { offset = 1, limit } = input;
		const filePath = normalizeDocumentPath(input.file_path);

		const dfs = services.fs;
		if (!dfs) {
			return "Documents not existe.";
		}
		let content: Uint8Array;
		try {
			content = await readFileBytes(dfs, filePath);
		} catch {
			return `Error: File not found: ${input.file_path}`;
		}

		const fileType = inferFileType(filePath);
		const text = await extractReadableText(fileType, content);

		if (!text) {
			return `Error: Cannot read binary file (${fileType}): ${input.file_path}. Only text, markdown, excel, and pdf files can be read.`;
		}
		const allLines = text.split("\n");
		const totalLines = allLines.length;

		const startIdx = Math.max(0, offset - 1);
		const endIdx = limit ? Math.min(startIdx + limit, totalLines) : totalLines;
		const selectedLines = allLines.slice(startIdx, endIdx);

		const maxLineNum = endIdx;
		const padWidth = String(maxLineNum).length;

		const numberedLines = selectedLines.map((line, i) => {
			const lineNum = String(startIdx + i + 1).padStart(padWidth);
			return `${lineNum}\t${line}`;
		});

		const rangeInfo =
			startIdx > 0 || endIdx < totalLines
				? ` (showing lines ${startIdx + 1}-${endIdx})`
				: "";

		return `File: ${filePath} (${totalLines} lines)${rangeInfo}\n${numberedLines.join("\n")}`;
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createDocReadTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
