import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";

const TOOL_NAME = "container_clear_logs" as const;

const schema = z.object({});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerClearLogsTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Clear sandbox container logs.",
	schema,
	execute: async () => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.clearLogs();
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerClearLogsTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
