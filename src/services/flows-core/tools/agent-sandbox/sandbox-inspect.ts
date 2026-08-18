import { z } from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import {
	executeSandboxOperation,
	SANDBOX_TOOL_OUTPUT_SCHEMA,
	validateOperationFields,
} from "./tool-utils";

const TOOL_NAME = "sandbox_inspect" as const;
const schema = z
	.object({
		operation: z.enum(["status", "logs", "clear_logs", "reset"]),
		limit: z.number().int().min(1).max(500).optional(),
		level: z.enum(["log", "info", "warn", "error", "debug"]).optional(),
	})
	.strict()
	.superRefine((data, ctx) => {
		validateOperationFields(
			data,
			ctx,
			data.operation === "logs" ? ["limit", "level"] : [],
		);
	});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxInspectTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Inspect sandbox",
	description:
		"Inspect sandbox status or logs, clear logs, or reset the active session.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: { readOnlyHint: false, idempotentHint: false },
	metadata: { category: "sandbox", icon: "activity" },
	execute: (input, context) =>
		executeSandboxOperation(
			services.sandboxRuntime,
			TOOL_NAME,
			input.operation,
			context,
			(service, callContext) => service.inspect(input, callContext),
		),
});

toolRegistry.register(TOOL_NAME, createSandboxInspectTool);
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
