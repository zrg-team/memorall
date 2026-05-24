import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeFsPath, displayPathToFsPath, removePath } from "./util";

const TOOL_NAME = "fs_remove" as const;

const schema = z.object({
	path: z.string().describe("Path of the file or directory to delete"),
	recursive: z
		.boolean()
		.optional()
		.describe(
			"Delete a directory and all its contents recursively (required for non-empty directories, default: false)",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsRemoveTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Delete a file or directory. For non-empty directories, set recursive: true to delete all contents.",
	schema,
	execute: async (input) => {
		const { path, recursive = false } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const targetPath = normalizeFsPath(path);

		if (displayPathToFsPath(targetPath) === "/") {
			return "Error: Cannot delete the root directory.";
		}

		try {
			const stat = await dfs.stat(displayPathToFsPath(targetPath));
			await removePath(dfs, targetPath, recursive);
			return `Deleted ${stat.isDirectory() ? "directory" : "file"}${recursive ? " (recursive)" : ""}: ${targetPath}`;
		} catch (error) {
			return `Error: Failed to delete ${targetPath}: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createFsRemoveTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
