import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { mkdirPath, normalizeFsPath, pathExists } from "./util";

const TOOL_NAME = "document_fs_mkdir" as const;

const schema = z.object({
	path: z.string().describe("Directory path to create"),
	recursive: z
		.boolean()
		.optional()
		.describe(
			"Create all missing parent directories automatically (default: true)",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsMkdirTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create a directory. By default creates all missing parent directories. Does nothing if the directory already exists.",
	schema,
	execute: async (input) => {
		const { path, recursive = true } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const dirPath = normalizeFsPath(path);

		if (dirPath === "/") {
			return "Error: Cannot create the root directory.";
		}

		if (await pathExists(dfs, dirPath)) {
			return `Directory already exists: ${dirPath}`;
		}

		try {
			await mkdirPath(dfs, dirPath, recursive);
			return `Created directory: ${dirPath}`;
		} catch (error) {
			return `Error: Failed to create directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createFsMkdirTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
