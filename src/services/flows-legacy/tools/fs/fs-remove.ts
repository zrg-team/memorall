import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import type { FsToolConfig } from "@/services/flows-legacy/tools/fs/config";
import {
	normalizeFsPath,
	displayPathToFsPath,
	removePath,
} from "@/services/flows-legacy/tools/fs/util";

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
