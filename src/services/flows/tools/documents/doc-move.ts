import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "./util";
import { displayPathToFsPath } from "../fs/util";

const TOOL_NAME = "doc_move" as const;

const schema = z
	.object({
		source_path: z.string().describe("Current file or folder path"),
		new_name: z.string().optional().describe("New name (rename mode)"),
		target_folder: z
			.string()
			.optional()
			.describe("Destination folder path (move mode)"),
	})
	.refine((data) => data.new_name || data.target_folder, {
		message: "At least one of new_name or target_folder must be provided",
	});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createDocMoveTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Move or rename a document file or folder. Provide new_name to rename, target_folder to move, or both to move and rename.",
	schema,
	execute: async (input) => {
		const { source_path, new_name, target_folder } = input;
		const sourcePath = normalizeDocumentPath(source_path);
		const targetFolder =
			typeof target_folder === "string"
				? normalizeDocumentPath(target_folder)
				: undefined;

		const dfs = services.fs;
		if (!dfs) {
			return "Documents not existe.";
		}

		let isFile = true;
		try {
			const stat = await dfs.stat(displayPathToFsPath(sourcePath));
			isFile = stat.isFile();
		} catch {
			return `Error: Path not found: ${sourcePath}`;
		}
		let currentPath = sourcePath;
		const actions: string[] = [];

		// Move first (if targetFolder provided)
		if (targetFolder) {
			const name = currentPath.split("/").filter(Boolean).at(-1);
			if (!name) return `Error: Invalid source path: ${sourcePath}`;
			const targetPath = `${targetFolder.replace(/\/+$/, "")}/${name}`;
			await dfs.rename(
				displayPathToFsPath(currentPath),
				displayPathToFsPath(targetPath),
			);
			currentPath = targetPath;
			actions.push(`moved to ${targetFolder}`);
		}

		// Then rename (if new_name provided)
		if (new_name) {
			const parent = currentPath.slice(0, currentPath.lastIndexOf("/")) || "/";
			const targetPath =
				parent === "/" ? `/${new_name}` : `${parent}/${new_name}`;
			await dfs.rename(
				displayPathToFsPath(currentPath),
				displayPathToFsPath(targetPath),
			);
			currentPath = targetPath;
			actions.push(`renamed to "${new_name}"`);
		}

		return `${isFile ? "File" : "Folder"} ${sourcePath}: ${actions.join(", ")} → ${currentPath}`;
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createDocMoveTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
