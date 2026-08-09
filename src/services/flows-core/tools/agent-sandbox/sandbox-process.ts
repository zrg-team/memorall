import { z } from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { SandboxProcessRequest } from "flow-core/interfaces/services/agent-sandbox";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { executeSandboxOperation, SANDBOX_TOOL_OUTPUT_SCHEMA, validateOperationFields } from "./tool-utils";

const TOOL_NAME = "sandbox_process" as const;
const schema = z.object({
	operation: z.enum(["list", "read", "stdin", "stop"]),
	processId: z.string().min(1).optional(),
	cursor: z.string().optional(),
	waitMs: z.number().int().min(0).max(120_000).optional(),
	maxChars: z.number().int().min(1).max(200_000).optional(),
	input: z.string().optional(),
	appendNewline: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
	const rules = {
		list: { allowed: [], required: [] },
		read: { allowed: ["processId", "cursor", "waitMs", "maxChars"], required: ["processId"] },
		stdin: { allowed: ["processId", "input", "appendNewline"], required: ["processId", "input"] },
		stop: { allowed: ["processId"], required: ["processId"] },
	} as const;
	const rule = rules[data.operation];
	validateOperationFields(data, ctx, rule.allowed, rule.required);
});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxProcessTool: ToolFactory<Input, Services> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Manage sandbox processes",
	description: "List, read with an opaque cursor, write stdin to, or stop sandbox processes.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: { readOnlyHint: false, idempotentHint: false },
	metadata: { category: "sandbox", icon: "terminal" },
	execute: (input, context) => executeSandboxOperation(
		services.sandboxRuntime,
		TOOL_NAME,
		input.operation,
		context,
		(service, callContext) => service.process(input as SandboxProcessRequest, callContext),
	),
});

toolRegistry.register(TOOL_NAME, createSandboxProcessTool);
declare global { interface ToolTypeRegistry { [TOOL_NAME]: { input: Input; services: Services } } }
