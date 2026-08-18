import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import { compositionFile } from "./util";
import { readFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";
import type { HyperframesToolConfig } from "./config";

const TOOL_NAME = "hyperframes_read" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. Call hyperframes_list first if you do not already know this path — never guess values like 'default'.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesReadTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read the current composition HTML for a HyperFrames project. Use this to inspect the current state before editing, or to verify the content after writing.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = compositionFile(input.project_path, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return `Error: ${file} not found. Use hyperframes_write to create the project first.`;
		}

		const html = new TextDecoder().decode(raw);
		return `${file} (${html.length} chars):\n\n${html}`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesReadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
