import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import { animationFile } from "@/services/flows-core/tools/lottie/util";
import { readFileBytes } from "@/services/flows-core/tools/fs/util";
import type { LottieToolConfig } from "@/services/flows-core/tools/lottie/config";

const TOOL_NAME = "lottie_read" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. Call lottie_list first if you do not already know this path — never guess values like 'default'.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createLottieReadTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read the current Lottie/Bodymovin JSON for an animation project. Use this to inspect the current state before editing, or to verify the content after writing.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = animationFile(input.project_path, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return `Error: ${file} not found. Use lottie_init to create the project first.`;
		}

		const json = new TextDecoder().decode(raw);
		return `${file} (${json.length} chars):\n\n${json}`;
	},
});

toolRegistry.register(TOOL_NAME, createLottieReadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
