import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import { animationFile } from "@/services/flows-core/tools/lottie/util";
import { writeFileBytes } from "@/services/flows-core/tools/fs/util";
import type { LottieToolConfig } from "@/services/flows-core/tools/lottie/config";

const TOOL_NAME = "lottie_write" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. For existing projects, call lottie_list first — never guess values like 'default'.",
		),
	content: z
		.string()
		.min(1)
		.describe("Full Lottie/Bodymovin JSON document (as a JSON string)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createLottieWriteTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create or overwrite the Lottie/Bodymovin JSON for an animation project. The file is always saved as animation.json inside the project directory. Rejects malformed JSON.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		try {
			JSON.parse(input.content);
		} catch (error) {
			return `Error: content is not valid JSON — ${error instanceof Error ? error.message : String(error)}`;
		}

		const file = animationFile(input.project_path, config?.rootPath);
		await writeFileBytes(dfs, file, input.content, true, config);
		return `Saved: ${file}`;
	},
});

toolRegistry.register(TOOL_NAME, createLottieWriteTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
