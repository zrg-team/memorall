import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_get_logs" as const;

const schema = z.object({
	limit: z
		.number()
		.int()
		.min(1)
		.max(500)
		.optional()
		.describe("Maximum number of log entries to return (default 100)."),
	level: z
		.enum(["log", "info", "warn", "error", "debug"])
		.optional()
		.describe("Optional log level filter."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerGetLogsTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Get recent sandbox container logs.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.getLogs({
			limit: input.limit ?? 100,
			level: input.level,
		});
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerGetLogsTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
