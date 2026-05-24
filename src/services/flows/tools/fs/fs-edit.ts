import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeFsPath, readFileBytes, writeFileBytes } from "./util";

const TOOL_NAME = "fs_edit" as const;

const schema = z.object({
	file_path: z.string().describe("Path to the file to edit"),
	old_string: z
		.string()
		.describe("Exact text to find and replace. Must be present in the file."),
	new_string: z.string().describe("Replacement text"),
	replace_all: z
		.boolean()
		.optional()
		.describe(
			"Replace every occurrence instead of only the first (default: false)",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsEditTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Edit a text file by replacing old_string with new_string. By default only the first occurrence is replaced; set replace_all to true to replace every occurrence. Fails if old_string is not found.",
	schema,
	execute: async (input) => {
		const { file_path, old_string, new_string, replace_all = false } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const filePath = normalizeFsPath(file_path);

		const applyEdit = (text: string): { newText: string; count: number } => {
			if (!text.includes(old_string)) {
				throw new Error(`old_string not found in ${filePath}`);
			}
			if (replace_all) {
				const count = text.split(old_string).length - 1;
				return { newText: text.split(old_string).join(new_string), count };
			}
			return { newText: text.replace(old_string, new_string), count: 1 };
		};

		let text: string;
		try {
			text = new TextDecoder().decode(await readFileBytes(dfs, filePath));
		} catch {
			return `Error: File not found: ${file_path}`;
		}

		let result: { newText: string; count: number };
		try {
			result = applyEdit(text);
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`;
		}

		await writeFileBytes(dfs, filePath, result.newText);

		return `Edited ${filePath}: ${result.count} replacement${result.count !== 1 ? "s" : ""} made`;
	},
});

toolRegistry.register(TOOL_NAME, createFsEditTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
