import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import { animationFile } from "@/services/flows-core/tools/lottie/util";
import {
	readFileBytes,
	writeFileBytes,
} from "@/services/flows-core/tools/fs/util";
import type { LottieToolConfig } from "@/services/flows-core/tools/lottie/config";

const TOOL_NAME = "lottie_edit" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. Call lottie_list first if you do not already know this path — never guess values like 'default'.",
		),
	old_string: z
		.string()
		.describe(
			"Exact text to find and replace. Must be present in animation.json.",
		),
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

export const createLottieEditTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Edit animation.json by replacing old_string with new_string. Prefer this over lottie_write when changing a small portion of an existing animation (e.g. a color, keyframe value, or single property). By default only the first occurrence is replaced; set replace_all to true to replace every occurrence. Fails if old_string is not found or if the result would not be valid JSON.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = animationFile(input.project_path, config?.rootPath);

		let json: string;
		try {
			json = new TextDecoder().decode(await readFileBytes(dfs, file, config));
		} catch {
			return `Error: ${file} not found. Use lottie_init to create the project first.`;
		}

		const { old_string, new_string, replace_all = false } = input;

		if (!json.includes(old_string)) {
			return `Error: old_string not found in ${file}`;
		}

		const count = replace_all ? json.split(old_string).length - 1 : 1;
		const updated = replace_all
			? json.split(old_string).join(new_string)
			: json.replace(old_string, new_string);

		try {
			JSON.parse(updated);
		} catch (error) {
			return `Error: edit would produce invalid JSON — ${error instanceof Error ? error.message : String(error)}`;
		}

		await writeFileBytes(dfs, file, updated, true, config);

		return `Edited ${file}: ${count} replacement${count !== 1 ? "s" : ""} made`;
	},
});

toolRegistry.register(TOOL_NAME, createLottieEditTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
