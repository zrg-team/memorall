import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { formatCommandResult } from "./container-command-output";

const TOOL_NAME = "container_listen_command" as const;

const schema = z.object({
	commandId: z
		.string()
		.min(1)
		.describe("Command session ID returned by container_execute_command."),
	offset: z
		.number()
		.int()
		.min(0)
		.describe("Last nextOffset received from the command session."),
	waitTimeoutMs: z
		.number()
		.int()
		.min(0)
		.max(120_000)
		.optional()
		.describe(
			"How long to wait for more output or completion before returning (default 10000).",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerListenCommandTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Continue listening to a previously started sandbox command. Returns only new stdout/stderr since the supplied offset.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}

		const result = await services.sandboxContainer.listenCommand(input);
		return formatCommandResult(result);
	},
});

toolRegistry.register(TOOL_NAME, createContainerListenCommandTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
