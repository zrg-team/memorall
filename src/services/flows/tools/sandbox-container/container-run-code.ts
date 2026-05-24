import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_run_code" as const;

const schema = z.object({
	code: z.string().min(1).describe("JavaScript/TypeScript code to run."),
	filename: z
		.string()
		.optional()
		.describe("Optional virtual filename for better stack traces."),
	timeoutMs: z
		.number()
		.min(10)
		.max(120_000)
		.optional()
		.describe("Execution timeout in milliseconds (default 5000)."),
	maxLogEntries: z
		.number()
		.min(1)
		.max(500)
		.optional()
		.describe("Maximum number of captured console logs (default 50)."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerRunCodeTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Run JavaScript/TypeScript code in the sandbox container. The runtime is browser-based with `console` and `require` available. Use `require()` for installed packages (install via container_install_package first) or virtual filesystem modules. A limited `require('fs')` shim is available for virtual filesystem access (including read-only /documents listing), but native Node.js built-ins are not fully supported.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.executeCode({
			code: input.code,
			filename: input.filename,
			timeoutMs: input.timeoutMs ?? 60_000,
			maxLogEntries: input.maxLogEntries ?? 50,
		});
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerRunCodeTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
