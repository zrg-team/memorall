import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	parseExcelFile,
	workbookToMarkdown,
	sheetToMarkdown,
	sheetToCsv,
} from "@/main/modules/documents/handlers/excel-extraction";
import { normalizeDocumentPath } from "./util";
import { ensureFolderExists } from "../../utils/document-fs-utils";
import { pathExists, readFileBytes, writeFileBytes } from "../fs/util";

const TOOL_NAME = "excel_to_text" as const;

const schema = z.object({
	source_path: z
		.string()
		.describe(
			"Path to the Excel file in /documents. Must end with .xls, .xlsx, or .xlsm.",
		),
	output_path: z
		.string()
		.optional()
		.describe(
			"Optional path to save the extracted text in /documents. If omitted, the text is returned directly.",
		),
	format: z
		.enum(["markdown", "csv"])
		.optional()
		.describe(
			"Output format: `markdown` (default) renders each sheet as a Markdown table with a heading; `csv` renders each sheet as CSV rows.",
		),
	sheets: z
		.array(z.string())
		.optional()
		.describe(
			"Optional list of sheet names to include. Defaults to all sheets.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

function isExcelPath(p: string): boolean {
	const lower = p.toLowerCase();
	return (
		lower.endsWith(".xls") || lower.endsWith(".xlsx") || lower.endsWith(".xlsm")
	);
}

export const createExcelToTextTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Extract text from an Excel file in /documents and return it or save it to a new file. Supports Markdown table or CSV output with optional sheet filtering.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) {
			return JSON.stringify({
				actionType: "excel_to_text",
				success: false,
				error: "Document filesystem service is not available.",
			});
		}

		const sourcePath = normalizeDocumentPath(input.source_path);
		if (!isExcelPath(sourcePath)) {
			return JSON.stringify({
				actionType: "excel_to_text",
				success: false,
				error: `source_path must end with .xls / .xlsx / .xlsm, got: ${input.source_path}`,
			});
		}

		try {
			if (!(await pathExists(dfs, sourcePath))) {
				return JSON.stringify({
					actionType: "excel_to_text",
					success: false,
					error: `File not found: ${input.source_path}`,
				});
			}

			const content = await readFileBytes(dfs, sourcePath);
			const workbook = await parseExcelFile(content);

			const targetSheets = input.sheets?.length
				? input.sheets.filter((s) => workbook.SheetNames.includes(s))
				: workbook.SheetNames;

			if (targetSheets.length === 0) {
				return JSON.stringify({
					actionType: "excel_to_text",
					success: false,
					error: "No matching sheets found in the workbook.",
				});
			}

			const fmt = input.format ?? "markdown";
			let extractedText: string;

			if (fmt === "csv") {
				extractedText = targetSheets
					.map(
						(sheetName) =>
							`### ${sheetName}\n\n${sheetToCsv(workbook, sheetName)}`,
					)
					.join("\n\n");
			} else if (targetSheets.length === workbook.SheetNames.length) {
				extractedText = workbookToMarkdown(workbook);
			} else {
				extractedText = targetSheets
					.map(
						(sheetName) =>
							`## ${sheetName}\n\n${sheetToMarkdown(workbook, sheetName)}`,
					)
					.join("\n\n");
			}

			if (!input.output_path) {
				return JSON.stringify(
					{
						actionType: "excel_to_text",
						success: true,
						source_path: sourcePath,
						sheet_count: targetSheets.length,
						sheets: targetSheets,
						format: fmt,
						text: extractedText,
					},
					null,
					2,
				);
			}

			// Save to output_path
			const outputPath = normalizeDocumentPath(input.output_path);
			const lastSlash = outputPath.lastIndexOf("/");
			const parentPath =
				lastSlash > 0 ? outputPath.substring(0, lastSlash) : "/";
			const fileName = outputPath.substring(lastSlash + 1);

			if (!fileName) {
				return JSON.stringify({
					actionType: "excel_to_text",
					success: false,
					error: "Invalid output_path — no filename provided.",
				});
			}

			await ensureFolderExists(dfs, parentPath);
			await writeFileBytes(dfs, outputPath, extractedText);

			return JSON.stringify(
				{
					actionType: "excel_to_text",
					success: true,
					source_path: sourcePath,
					output_path: outputPath,
					sheet_count: targetSheets.length,
					sheets: targetSheets,
					format: fmt,
					characters: extractedText.length,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				actionType: "excel_to_text",
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

toolRegistry.register(TOOL_NAME, createExcelToTextTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
