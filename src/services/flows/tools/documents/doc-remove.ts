import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "./util";
import { displayPathToFsPath, removePath } from "../fs/util";

const TOOL_NAME = "doc_remove" as const;

const schema = z.object({
	path: z.string().describe("File or folder path to delete"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createDocRemoveTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Delete a document file or folder. Folders are deleted recursively.",
	schema,
	execute: async (input) => {
		const { path } = input;
		const filePath = normalizeDocumentPath(path);

		const dfs = services.fs;
		if (!dfs) {
			return "Documents not existe.";
		}
		if (displayPathToFsPath(filePath) === "/") {
			return "Error: Cannot delete the root directory.";
		}

		try {
			const stat = await dfs.stat(displayPathToFsPath(filePath));
			await removePath(dfs, filePath, true);
			return `Deleted ${stat.isDirectory() ? "folder" : "file"}: ${filePath}`;
		} catch {
			return `Error: Path not found: ${filePath}`;
		}
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createDocRemoveTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
