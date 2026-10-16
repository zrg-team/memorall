import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import { HYPERFRAMES_PROJECT_FILES, projectFile } from "./util";
import { writeFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";
import type { HyperframesToolConfig } from "./config";
import { lintSavedComposition } from "./hyperframes-validate";

const TOOL_NAME = "hyperframes_write" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. For new projects choose a meaningful name under the workspace root. For existing projects, call hyperframes_list first — never guess values like 'default'.",
		),
	content: z
		.string()
		.min(1)
		.describe(
			"The file's full content: the composition HTML, or the design spec markdown",
		),
	file: z
		.enum(HYPERFRAMES_PROJECT_FILES)
		.optional()
		.describe(
			"Which project file: index.html (the composition, default), frame.md (the frame-scale design spec that directs the composition) or design.md (the brand spec).",
		),
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
		"Create or overwrite a HyperFrames project file: the composition (index.html, the default) or its design spec (frame.md / design.md). Returns the validation report for a saved composition.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const target = input.file ?? "index.html";
		const file = projectFile(input.project_path, target, config?.rootPath);
		await writeFileBytes(dfs, file, input.content, true, config);
		if (target !== "index.html") return `Saved: ${file}`;
		const lint = await lintSavedComposition(
			input.content,
			dfs,
			input.project_path,
			file,
			config,
		);
		return `Saved: ${file}\n${lint}`;
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
