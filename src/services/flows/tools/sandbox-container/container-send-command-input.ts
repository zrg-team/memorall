import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { formatCommandInputResult } from "./container-command-output";

const TOOL_NAME = "container_send_command_input" as const;

const schema = z.object({
	commandId: z.string().min(1).describe("Running command session ID."),
	input: z.string().describe("Input to send to the command stdin."),
	appendNewline: z
		.boolean()
		.optional()
		.describe("Append a newline after the input before sending."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerSendCommandInputTool: ToolFactory<
	Input,
	Services
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Send stdin to a running sandbox command. Use this only when the command is waiting for interactive input.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}

		const result = await services.sandboxContainer.sendCommandInput(input);
		return formatCommandInputResult(result);
	},
});

toolRegistry.register(TOOL_NAME, createContainerSendCommandInputTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
