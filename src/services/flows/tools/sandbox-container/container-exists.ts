import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_exists" as const;

const schema = z.object({
	path: z
		.string()
		.min(1)
		.describe("Virtual path to check (absolute or relative)."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerExistsTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description: "Check whether a file or directory exists in container FS.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.exists(input);
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerExistsTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
