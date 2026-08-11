import { z } from "zod";
import type { Tool, ToolFactory } from "@/services/flows-legacy/interfaces/engine/tool";
import type { SandboxSnapshotRequest } from "@/services/flows-legacy/interfaces/services/agent-sandbox";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import { executeSandboxOperation, SANDBOX_TOOL_OUTPUT_SCHEMA, validateOperationFields } from "./tool-utils";

const TOOL_NAME = "sandbox_snapshot" as const;
const schema = z.object({
	operation: z.enum(["create", "restore"]),
	label: z.string().min(1).max(120).optional(),
	snapshotId: z.string().min(1).optional(),
}).strict().superRefine((data, ctx) => {
	const rule = data.operation === "create"
		? { allowed: ["label"], required: [] }
		: { allowed: ["snapshotId"], required: ["snapshotId"] };
	validateOperationFields(data, ctx, rule.allowed, rule.required);
});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxSnapshotTool: ToolFactory<Input, Services> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Manage sandbox snapshots",
	description: "Capture or restore an opaque snapshot of the active sandbox session.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: { readOnlyHint: false, idempotentHint: false },
	metadata: { category: "sandbox", icon: "history" },
	execute: (input, context) => executeSandboxOperation(
		services.sandboxRuntime,
		TOOL_NAME,
		input.operation,
		context,
		(service, callContext) => service.snapshot(input as SandboxSnapshotRequest, callContext),
	),
});

toolRegistry.register(TOOL_NAME, createSandboxSnapshotTool);
declare global { interface ToolTypeRegistry { [TOOL_NAME]: { input: Input; services: Services } } }
