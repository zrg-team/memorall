import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "./util";
import { readFileBytes, writeFileBytes } from "../fs/util";

const TOOL_NAME = "doc_edit" as const;

const schema = z.object({
	file_path: z.string().describe("File to edit"),
	old_string: z.string().describe("Text to find"),
	new_string: z.string().describe("Replacement text"),
	replace_all: z
		.boolean()
		.optional()
		.describe("Replace all occurrences (default: false)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createDocEditTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Edit a document file by replacing text. Finds old_string in the file and replaces it with new_string. Only works on text-based files.",
	schema,
	execute: async (input) => {
		const { file_path, old_string, new_string, replace_all = false } = input;
		const filePath = normalizeDocumentPath(file_path);

		const dfs = services.fs;
		if (!dfs) {
			return "Documents not existe.";
		}
		if (/\.(pdf|xls|xlsx|xlsm)$/i.test(filePath)) {
			return `Error: Cannot edit binary file: ${file_path}. Only text, markdown, and other text-based files can be edited.`;
		}

		let text: string;
		try {
			text = new TextDecoder().decode(await readFileBytes(dfs, filePath));
		} catch {
			return `Error: File not found: ${filePath}`;
		}

		if (!text.includes(old_string)) {
			return `Error: old_string not found in ${filePath}`;
		}

		let newText: string;
		let count: number;

		if (replace_all) {
			// Count occurrences
			count = text.split(old_string).length - 1;
			newText = text.split(old_string).join(new_string);
		} else {
			count = 1;
			newText = text.replace(old_string, new_string);
		}

		await writeFileBytes(dfs, filePath, newText);

		return `Edited ${filePath}: ${count} replacement${count !== 1 ? "s" : ""} made`;
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createDocEditTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
