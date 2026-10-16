import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import { HYPERFRAMES_PROJECT_FILES, projectFile } from "./util";
import {
	readFileBytes,
	writeFileBytes,
} from "@memorall/agent-harness-flows/tools/fs/util";
import type { HyperframesToolConfig } from "./config";
import { lintSavedComposition } from "./hyperframes-validate";

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
		.describe("Exact text to find and replace. Must be present in the file."),
	new_string: z.string().describe("Replacement text"),
	replace_all: z
		.boolean()
		.optional()
		.describe(
			"Replace every occurrence instead of only the first (default: false)",
		),
	file: z
		.enum(HYPERFRAMES_PROJECT_FILES)
		.optional()
		.describe(
			"Which project file: index.html (the composition, default), frame.md or design.md (the design spec).",
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
		"Edit a HyperFrames project file (the composition index.html by default, or frame.md / design.md) by replacing old_string with new_string. Prefer this over hyperframes_write when changing a small portion of a large composition. By default only the first occurrence is replaced; set replace_all to true to replace every occurrence. Fails if old_string is not found. Returns the validation report for the edited composition.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const target = input.file ?? "index.html";
		const file = projectFile(input.project_path, target, config?.rootPath);

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
		// A replacer function keeps `$&`, `$$`, `` $` `` and `$'` literal.
		const updated = replace_all
			? html.split(old_string).join(new_string)
			: html.replace(old_string, () => new_string);

		await writeFileBytes(dfs, file, updated, true, config);
		const summary = `Edited ${file}: ${count} replacement${count !== 1 ? "s" : ""} made`;
		if (target !== "index.html") return summary;
		const lint = await lintSavedComposition(
			updated,
			dfs,
			input.project_path,
			file,
			config,
		);

		return `${summary}\n${lint}`;
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
