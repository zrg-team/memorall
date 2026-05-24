import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeFsPath, readFileBytes } from "./util";

const TOOL_NAME = "fs_read" as const;

const schema = z.object({
	file_path: z.string().describe("Path to the file to read"),
	offset: z
		.number()
		.optional()
		.describe("Start line number, 1-based (default: 1)"),
	limit: z.number().optional().describe("Maximum number of lines to return"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsReadTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read a file with line numbers (cat -n style). Returns a header with total lines and the selected range. Use offset and limit to read large files in chunks.",
	schema,
	execute: async (input) => {
		const { file_path, offset = 1, limit } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const filePath = normalizeFsPath(file_path);

		const readAndFormat = (raw: Uint8Array, displayPath: string): string => {
			const text = new TextDecoder().decode(raw);
			const allLines = text.split("\n");
			const totalLines = allLines.length;

			const startIdx = Math.max(0, offset - 1);
			const endIdx = limit
				? Math.min(startIdx + limit, totalLines)
				: totalLines;
			const selectedLines = allLines.slice(startIdx, endIdx);

			const padWidth = String(endIdx).length;
			const numberedLines = selectedLines.map((line, i) => {
				const lineNum = String(startIdx + i + 1).padStart(padWidth);
				return `${lineNum}\t${line}`;
			});

			const rangeInfo =
				startIdx > 0 || endIdx < totalLines
					? ` (showing lines ${startIdx + 1}-${endIdx})`
					: "";

			return `File: ${displayPath} (${totalLines} lines)${rangeInfo}\n${numberedLines.join("\n")}`;
		};

		try {
			const raw = await readFileBytes(dfs, filePath);
			return readAndFormat(raw, filePath);
		} catch {
			return `Error: File not found: ${file_path}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createFsReadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
