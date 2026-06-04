import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import { toolRegistry } from "flow-core/registries/tool-registry";

const TOOL_NAME = "current_time" as const;

const schema = z.object({
	timezone: z.string().optional().describe("Timezone (default: UTC)"),
});

type Input = z.infer<typeof schema>;

export const createCurrentTimeTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Get the current date and time",
	schema,
	execute: async (input) => {
		const { timezone = "UTC" } = input;
		const now = new Date();

		if (timezone === "UTC") {
			return `Current UTC time: ${now.toISOString()}`;
		} else {
			return `Current time in ${timezone}: ${now.toLocaleString("en-US", { timeZone: timezone })}`;
		}
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createCurrentTimeTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
