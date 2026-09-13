import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import type { FsToolConfig } from "./config.js";
import {
	formatFileSize,
	displayPathToFsPath,
	normalizeFsPath,
	readFileBytes,
} from "./util.js";

const TOOL_NAME = "fs_read" as const;

/**
 * Largest file this will read as text. Generous for anything line-oriented;
 * anything past it is almost certainly binary, where numbered lines are
 * meaningless anyway.
 */
const MAX_READ_BYTES = 5 * 1024 * 1024;

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

export const createFsReadTool: ToolFactory<Input, Services, FsToolConfig> = (
	services,
	config,
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
			// Check the size before pulling the bytes in. The library's own files
			// are small, but a mapped folder is the user's real disk and can hold
			// a multi-gigabyte video — and this reads the whole file into memory
			// before it can split it into lines, so `offset`/`limit` do not save
			// it. One stat is cheap; an unbounded read is not survivable.
			const stat = await dfs.stat(displayPathToFsPath(filePath, config));
			if (stat.isDirectory()) {
				return `Error: Path is a directory, not a file: ${filePath}`;
			}
			if (stat.size > MAX_READ_BYTES) {
				return `Error: ${filePath} is ${formatFileSize(stat.size)}, over the ${formatFileSize(MAX_READ_BYTES)} limit for reading as text. Use fs_grep to search inside it, or pick a smaller file.`;
			}
		} catch (error) {
			// Keep the real reason: a mapped folder that is read-only or
			// disconnected explains itself here, and reporting "file not found"
			// for it would send the agent looking for a path that does exist.
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}

		try {
			const raw = await readFileBytes(dfs, filePath, config);
			return readAndFormat(raw, filePath);
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createFsReadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: FsToolConfig;
		};
	}
}
