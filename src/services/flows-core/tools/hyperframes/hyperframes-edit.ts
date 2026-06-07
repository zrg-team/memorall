import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { compositionFile } from "flow-core/tools/hyperframes/util";
import { readFileBytes, writeFileBytes } from "flow-core/tools/fs/util";
import type { HyperframesToolConfig } from "flow-core/tools/hyperframes/config";

const TOOL_NAME = "hyperframes_edit" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. Call hyperframes_list first if you do not already know this path — never guess values like 'default'.",
		),
	old_string: z
		.string()
		.describe("Exact text to find and replace. Must be present in index.html."),
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

export const createHyperframesEditTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Edit the composition HTML by replacing old_string with new_string inside index.html. Prefer this over hyperframes_write when changing a small portion of a large composition. By default only the first occurrence is replaced; set replace_all to true to replace every occurrence. Fails if old_string is not found.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = compositionFile(input.project_path, config?.rootPath);

		let html: string;
		try {
			html = new TextDecoder().decode(await readFileBytes(dfs, file, config));
		} catch {
			return `Error: ${file} not found. Use hyperframes_init or hyperframes_write to create the project first.`;
		}

		const { old_string, new_string, replace_all = false } = input;

		if (!html.includes(old_string)) {
			return `Error: old_string not found in ${file}`;
		}

		const count = replace_all ? html.split(old_string).length - 1 : 1;
		const updated = replace_all
			? html.split(old_string).join(new_string)
			: html.replace(old_string, new_string);

		await writeFileBytes(dfs, file, updated, true, config);

		return `Edited ${file}: ${count} replacement${count !== 1 ? "s" : ""} made`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesEditTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
