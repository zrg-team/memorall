import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { formatCommandList } from "flow-core/tools/sandbox-container/container-command-output";

const TOOL_NAME = "container_list_commands" as const;

const schema = z.object({});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerListCommandsTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "List currently running sandbox commands.",
	schema,
	execute: async () => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}

		const result = await services.sandboxContainer.listCommands();
		return formatCommandList(result.commands);
	},
});

toolRegistry.register(TOOL_NAME, createContainerListCommandsTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
