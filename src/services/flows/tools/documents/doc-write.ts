import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "./util";
import { pathExists, writeFileBytes } from "../fs/util";

const TOOL_NAME = "doc_write" as const;

const schema = z.object({
	file_path: z.string().describe("Target file path"),
	content: z.string().describe("Text content to write"),
	create_folders: z
		.boolean()
		.optional()
		.describe("Auto-create parent folders (default: true)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createDocWriteTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create or overwrite a document file. If the file exists, updates its content. If new, creates it (with parent folders by default). Only supports text-based files; PDF/Excel are not supported for writing. After using this tool, assistant messages should mention only the created or updated file path, not the file content.",
	schema,
	execute: async (input) => {
		const { file_path, content, create_folders = true } = input;
		const filePath = normalizeDocumentPath(file_path);

		const dfs = services.fs;
		if (!dfs) {
			return "Documents not existe.";
		}

		const lowerPath = filePath.toLowerCase();
		const isPdfPath = lowerPath.endsWith(".pdf");
		const isExcelPath =
			lowerPath.endsWith(".xls") ||
			lowerPath.endsWith(".xlsx") ||
			lowerPath.endsWith(".xlsm");

		if (isPdfPath || isExcelPath) {
			return `Error: Writing PDF/Excel files is not supported yet: ${file_path}`;
		}

		// Create new file
		const lastSlash = filePath.lastIndexOf("/");
		const parentPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : "/";
		const fileName = filePath.substring(lastSlash + 1);

		if (!fileName) {
			return "Error: Invalid file path - no filename provided";
		}

		const existed = await pathExists(dfs, filePath);
		await writeFileBytes(dfs, filePath, content, create_folders);

		return `${existed ? "Updated" : "Created"} file: ${filePath} (${content.length} characters)`;
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createDocWriteTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
