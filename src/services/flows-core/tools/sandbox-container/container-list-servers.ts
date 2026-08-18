import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";

const TOOL_NAME = "container_list_servers" as const;

const schema = z.object({});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerListServersTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "List all running sandbox servers.",
	schema,
	execute: async () => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.listServers();
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerListServersTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
