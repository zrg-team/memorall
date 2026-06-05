import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { compositionFile } from "flow-core/tools/hyperframes/util";
import { readFileBytes } from "flow-core/tools/fs/util";

const TOOL_NAME = "hyperframes_read" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory, e.g. /projects/product-launch",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesReadTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read the current composition HTML for a HyperFrames project. Use this to inspect the current state before editing, or to verify the content after writing.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = compositionFile(input.project_path);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file);
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
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
