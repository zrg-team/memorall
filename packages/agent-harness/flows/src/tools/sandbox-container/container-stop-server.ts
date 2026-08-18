import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";

const TOOL_NAME = "container_stop_server" as const;

const schema = z.object({
	port: z
		.number()
		.int()
		.min(1)
		.max(65535)
		.describe("Port of the server to stop."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerStopServerTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Stop a running sandbox server by port.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.stopServer({
			port: input.port,
		});
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerStopServerTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
