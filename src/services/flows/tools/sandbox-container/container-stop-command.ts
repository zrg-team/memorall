import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { formatCommandStopResult } from "./container-command-output";

const TOOL_NAME = "container_stop_command" as const;

const schema = z.object({
	commandId: z.string().min(1).describe("Running command session ID to stop."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerStopCommandTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Stop a running sandbox command session.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}

		const result = await services.sandboxContainer.stopCommand(input);
		return formatCommandStopResult(result);
	},
});

toolRegistry.register(TOOL_NAME, createContainerStopCommandTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
