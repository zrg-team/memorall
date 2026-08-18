import { z } from "zod";
import type {
	Tool,
	ToolFactory,
} from "../../interfaces/engine/tool.js";
import type { SandboxRunRequest } from "../../interfaces/services/agent-sandbox.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import {
	executeSandboxOperation,
	SANDBOX_TOOL_OUTPUT_SCHEMA,
	validateOperationFields,
} from "./tool-utils.js";

const TOOL_NAME = "sandbox_run" as const;
const schema = z
	.object({
		operation: z.enum(["code", "file", "command", "repl"]),
		code: z.string().min(1).optional(),
		path: z.string().min(1).optional(),
		filename: z.string().min(1).optional(),
		command: z.string().min(1).optional(),
		cwd: z.string().min(1).optional(),
		env: z.record(z.string(), z.string()).optional(),
		timeoutMs: z.number().int().min(10).max(120_000).optional(),
		waitTimeoutMs: z.number().int().min(0).max(120_000).optional(),
		commandTimeoutMs: z.number().int().min(10).max(600_000).optional(),
		maxLogEntries: z.number().int().min(1).max(500).optional(),
		replId: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((data, ctx) => {
		const rules = {
			code: {
				allowed: ["code", "filename", "timeoutMs", "maxLogEntries"],
				required: ["code"],
			},
			file: {
				allowed: ["path", "timeoutMs", "maxLogEntries"],
				required: ["path"],
			},
			command: {
				allowed: ["command", "cwd", "env", "waitTimeoutMs", "commandTimeoutMs"],
				required: ["command"],
			},
			repl: { allowed: ["code", "replId", "timeoutMs"], required: ["code"] },
		} as const;
		const rule = rules[data.operation];
		validateOperationFields(data, ctx, rule.allowed, rule.required);
	});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxRunTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Run in sandbox",
	description:
		"Run inline code, a workspace file, a command, or persistent REPL code in the active sandbox.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: { readOnlyHint: false, idempotentHint: false },
	metadata: { category: "sandbox", icon: "play" },
	execute: (input, context) =>
		executeSandboxOperation(
			services.sandboxRuntime,
			TOOL_NAME,
			input.operation,
			context,
			(service, callContext) =>
				service.run(input as SandboxRunRequest, callContext),
		),
});

toolRegistry.register(TOOL_NAME, createSandboxRunTool);
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
