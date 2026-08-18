import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import type { FsToolConfig } from "./config.js";
import {
	normalizeFsPath,
	displayPathToFsPath,
	removePath,
} from "./util.js";

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

export const createFsRemoveTool: ToolFactory<Input, Services, FsToolConfig> = (
	services,
	config,
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

		if (displayPathToFsPath(targetPath, config) === "/") {
			return "Error: Cannot delete the root directory.";
		}

		try {
			const stat = await dfs.stat(displayPathToFsPath(targetPath, config));
			await removePath(dfs, targetPath, recursive, config);
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
			config: FsToolConfig;
		};
	}
}
