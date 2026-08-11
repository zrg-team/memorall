import z from "zod";
import type { Tool, ToolFactory } from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import { compositionFile } from "@/services/flows-legacy/tools/hyperframes/util";
import { writeFileBytes } from "@/services/flows-legacy/tools/fs/util";
import type { HyperframesToolConfig } from "@/services/flows-legacy/tools/hyperframes/config";

const TOOL_NAME = "hyperframes_write" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. For new projects choose a meaningful name under the workspace root. For existing projects, call hyperframes_list first — never guess values like 'default'.",
		),
	content: z.string().min(1).describe("Full HyperFrames composition HTML"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesWriteTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create or overwrite the composition HTML for a HyperFrames project. The file is always saved as index.html inside the project directory.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = compositionFile(input.project_path, config?.rootPath);
		await writeFileBytes(dfs, file, input.content, true, config);
		return `Saved: ${file}`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesWriteTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
