import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	normalizeFsPath,
	collectGrepFileNodes,
	readFileBytes,
	runGrep,
} from "./util";

const TOOL_NAME = "fs_grep" as const;

const schema = z.object({
	pattern: z.string().describe("Regex pattern to search for in file content"),
	path: z
		.string()
		.optional()
		.describe(
			'Directory (or exact file path) to search (default: "/"). If a file path is provided, searches only that file.',
		),
	glob: z
		.string()
		.optional()
		.describe('Glob pattern to filter filenames (e.g. "*.ts", "**/*.md")'),
	case_sensitive: z
		.boolean()
		.optional()
		.describe("Case-sensitive matching (default: false)"),
	context: z
		.number()
		.optional()
		.describe(
			"Lines of context to show before and after each match (default: 0)",
		),
	max_results: z
		.number()
		.optional()
		.describe("Maximum matching lines to return (default: 50)"),
	output_mode: z
		.enum(["content", "files_with_matches", "count"])
		.optional()
		.describe(
			'"content" shows file:line:text (default), "files_with_matches" shows only file paths, "count" shows match count per file',
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsGrepTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		'Search file content with a JavaScript regex pattern. Returns results in grep-style "file:line:content" format. Supports context lines, minimatch glob filtering, and output modes. Use one broad regex and one broad glob when possible, e.g. pattern="memorall|icon|logo" glob="**/*.{ts,tsx,md,json,svg,png}".',
	schema,
	execute: async (input) => {
		const {
			pattern,
			path = "/",
			glob,
			case_sensitive = false,
			context = 0,
			max_results = 50,
			output_mode = "content",
		} = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const targetPath = normalizeFsPath(path);
		const fileNodes = await collectGrepFileNodes(dfs, targetPath, glob);

		if (fileNodes.length === 0) {
			return `No files found to search under "${targetPath}"${glob ? ` matching glob "${glob}"` : ""}`;
		}

		return runGrep(
			fileNodes,
			(displayPath) => readFileBytes(dfs, displayPath),
			{
				pattern,
				targetPath,
				glob,
				caseSensitive: case_sensitive,
				context,
				maxResults: max_results,
				outputMode: output_mode,
			},
		);
	},
});

toolRegistry.register(TOOL_NAME, createFsGrepTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
