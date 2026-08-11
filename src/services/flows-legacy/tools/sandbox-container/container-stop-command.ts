import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import { formatCommandStopResult } from "@/services/flows-legacy/tools/sandbox-container/container-command-output";

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
