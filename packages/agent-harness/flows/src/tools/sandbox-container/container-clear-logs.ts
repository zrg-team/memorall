import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";

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
