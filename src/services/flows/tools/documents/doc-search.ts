import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { readPDFFile } from "@/main/modules/documents/handlers/pdf-extraction";
import {
	parseExcelFile,
	workbookToMarkdown,
} from "@/main/modules/documents/handlers/excel-extraction";
import { normalizeDocumentPath } from "./util";
import {
	formatFileSize,
	globMatches,
	listEntries,
	readFileBytes,
	type FsEntry,
} from "../fs/util";

const TOOL_NAME = "doc_search" as const;

const schema = z.object({
	pattern: z
		.string()
		.optional()
		.describe(
			"Regex pattern to search file content. If omitted, lists files only",
		),
	path: z.string().optional().describe('Directory scope (default: "/")'),
	file_pattern: z
		.string()
		.optional()
		.describe('Glob to filter file names (e.g., "*.md")'),
	case_sensitive: z
		.boolean()
		.optional()
		.describe("Case sensitive search (default: false)"),
	max_results: z
		.number()
		.optional()
		.describe("Max matching lines (default: 50)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

const MAX_PDF_SEARCH_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_EXCEL_SEARCH_BYTES = 3 * 1024 * 1024; // 3MB

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

async function extractPdfText(content: Uint8Array): Promise<string> {
	const arrayBuffer = toArrayBuffer(content);
	const pdfContent = await readPDFFile(arrayBuffer);
	return (
		pdfContent.fullText || pdfContent.pages.map((p) => p.text).join("\n\n")
	);
}

async function extractExcelText(content: Uint8Array): Promise<string> {
	const workbook = await parseExcelFile(content);
	return workbookToMarkdown(workbook);
}

function inferFileType(path: string): "pdf" | "excel" | "text" | "binary" {
	const lower = path.toLowerCase();
	if (lower.endsWith(".pdf")) return "pdf";
	if (
		lower.endsWith(".xls") ||
		lower.endsWith(".xlsx") ||
		lower.endsWith(".xlsm")
	) {
		return "excel";
	}
	if (/\.(png|jpe?g|gif|webp|ico|zip|tar|gz|7z|mp4|mov|mp3)$/i.test(lower)) {
		return "binary";
	}
	return "text";
}

export const createDocSearchTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Search document files and content. Without a pattern, lists files with size/type info. With a pattern, searches text/PDF/Excel content (best-effort) and returns matching lines in ripgrep format. Large or unsupported binaries fall back to path-only matching with a note.",
	schema,
	execute: async (input) => {
		const {
			pattern,
			path = "/",
			file_pattern,
			case_sensitive = false,
			max_results = 50,
		} = input;

		const dfs = services.fs;
		if (!dfs) {
			return "Documents not existe.";
		}
		const normalizedPath = normalizeDocumentPath(path);

		const scopedNodes = await listEntries(dfs, normalizedPath, true);

		// Filter by file_pattern glob
		const filteredNodes = scopedNodes.filter((n) => {
			if (!file_pattern) return true;
			return globMatches(file_pattern, n.name);
		});

		// List mode (no pattern)
		if (!pattern) {
			const files = filteredNodes.filter((n) => n.type === "file");
			const folders = filteredNodes.filter((n) => n.type === "folder");

			const lines: string[] = [];
			for (const f of folders) {
				lines.push(`${f.path}/`);
			}
			for (const f of files) {
				lines.push(
					`${f.path}  (${inferFileType(f.path)}, ${formatFileSize(f.size ?? 0)})`,
				);
			}

			if (lines.length === 0) {
				return `No files found under "${normalizedPath}"${file_pattern ? ` matching "${file_pattern}"` : ""}`;
			}

			return `${lines.length} items found:\n${lines.join("\n")}`;
		}

		// Grep mode (with pattern)
		let regex: RegExp;
		try {
			regex = new RegExp(pattern, case_sensitive ? "g" : "gi");
		} catch {
			// Invalid regex, fall back to literal match
			const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			regex = new RegExp(escaped, case_sensitive ? "g" : "gi");
		}

		const fileNodes = filteredNodes.filter(
			(n): n is FsEntry & { type: "file" } => n.type === "file",
		);

		const matches: string[] = [];
		let matchCount = 0;
		let filesWithMatches = 0;
		const skippedContent: string[] = [];

		for (const node of fileNodes) {
			if (matchCount >= max_results) break;

			try {
				const fileType = inferFileType(node.path);
				const content = await readFileBytes(dfs, node.path);
				let text: string | null = null;
				let pathOnlyFallback = false;

				if (fileType === "text") {
					text = new TextDecoder().decode(content);
				} else if (fileType === "pdf") {
					if ((node.size ?? content.length) > MAX_PDF_SEARCH_BYTES) {
						pathOnlyFallback = true;
						skippedContent.push(
							`${node.path} (pdf too large: ${formatFileSize(node.size ?? content.length)})`,
						);
					} else {
						text = await extractPdfText(content);
					}
				} else if (fileType === "excel") {
					if ((node.size ?? content.length) > MAX_EXCEL_SEARCH_BYTES) {
						pathOnlyFallback = true;
						skippedContent.push(
							`${node.path} (excel too large: ${formatFileSize(node.size ?? content.length)})`,
						);
					} else {
						text = await extractExcelText(content);
					}
				} else {
					pathOnlyFallback = true;
					skippedContent.push(
						`${node.path} (${fileType} content search not supported)`,
					);
				}

				const lines = text ? text.split("\n") : [];
				let fileHasMatch = false;

				if (lines.length > 0) {
					for (let i = 0; i < lines.length; i++) {
						if (matchCount >= max_results) break;
						regex.lastIndex = 0;
						if (regex.test(lines[i])) {
							if (!fileHasMatch) {
								filesWithMatches++;
								fileHasMatch = true;
							}
							matches.push(`${node.path}:${i + 1}:${lines[i]}`);
							matchCount++;
						}
					}
				} else if (pathOnlyFallback) {
					regex.lastIndex = 0;
					if (regex.test(node.path)) {
						if (!fileHasMatch) {
							filesWithMatches++;
							fileHasMatch = true;
						}
						matches.push(`${node.path}:0:${node.path}`);
						matchCount++;
					}
				}
			} catch {
				skippedContent.push(`${node.path} (failed to read content)`);
			}
		}

		if (matches.length === 0) {
			const note =
				skippedContent.length > 0
					? `\n\nNotes:\n- Content search skipped for: ${skippedContent.join(
							", ",
						)}\n- Path-only matching used for skipped files`
					: "";
			return `No matches found for "${pattern}" in searchable content under "${normalizedPath}"${note}`;
		}

		const notes =
			skippedContent.length > 0
				? `\n\nNotes:\n- Content search skipped for: ${skippedContent.join(
						", ",
					)}\n- Path-only matching used for skipped files`
				: "";

		return `${matches.join("\n")}\n\n${matchCount} matches in ${filesWithMatches} files${notes}`;
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createDocSearchTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
