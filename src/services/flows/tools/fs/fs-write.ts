import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeFsPath, pathExists, writeFileBytes } from "./util";

const TOOL_NAME = "fs_write" as const;

const schema = z.object({
	file_path: z.string().describe("Path of the file to create or overwrite"),
	content: z.string().describe("Text content to write"),
	create_dirs: z
		.boolean()
		.optional()
		.describe(
			"Auto-create parent directories if they do not exist (default: true)",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsWriteTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create or overwrite a text file. If the file exists its content is replaced. Parent directories are created automatically by default. After using this tool, assistant messages should mention only the created or updated file path, not the file content.",
	schema,
	execute: async (input) => {
		const { file_path, content, create_dirs = true } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const filePath = normalizeFsPath(file_path);

		if (filePath.endsWith("/")) {
			return `Error: Invalid file path — no filename provided: ${file_path}`;
		}

		const existed = await pathExists(dfs, filePath);
		await writeFileBytes(dfs, filePath, content, create_dirs);

		return `${existed ? "Updated" : "Created"} file: ${filePath} (${content.length} characters)`;
	},
});

toolRegistry.register(TOOL_NAME, createFsWriteTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
