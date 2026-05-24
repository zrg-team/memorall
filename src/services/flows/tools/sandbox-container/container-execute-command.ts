import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { formatCommandResult } from "./container-command-output";

const TOOL_NAME = "container_execute_command" as const;

const schema = z.object({
	command: z.string().min(1).describe("Shell command to execute."),
	cwd: z
		.string()
		.optional()
		.describe("Optional working directory inside the sandbox."),
	env: z
		.record(z.string(), z.string())
		.optional()
		.describe("Optional environment variables to prefix for this command."),
	waitTimeoutMs: z
		.number()
		.int()
		.min(0)
		.max(120_000)
		.optional()
		.describe(
			"How long to wait for output or completion before returning (default 10000).",
		),
	commandTimeoutMs: z
		.number()
		.int()
		.min(10)
		.max(600_000)
		.optional()
		.describe("Optional hard timeout for the command itself."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerExecuteCommandTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Run an arbitrary sandbox shell command. The call waits up to waitTimeoutMs (default 10000). If the result has completed=false, continue with container_listen_command using the returned commandId and nextOffset.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}

		const result = await services.sandboxContainer.executeCommand(input);
		return formatCommandResult(result);
	},
});

toolRegistry.register(TOOL_NAME, createContainerExecuteCommandTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
