import { z } from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { SandboxPackageRequest } from "flow-core/interfaces/services/agent-sandbox";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { executeSandboxOperation, SANDBOX_TOOL_OUTPUT_SCHEMA, validateOperationFields } from "./tool-utils";

const TOOL_NAME = "sandbox_packages" as const;
const schema = z.object({
	operation: z.enum(["install", "install_from_package_json", "list"]),
	packageSpec: z.string().min(1).optional(),
	save: z.boolean().optional(),
	saveDev: z.boolean().optional(),
}).strict().superRefine((data, ctx) => {
	const rules = {
		install: { allowed: ["packageSpec", "save", "saveDev"], required: ["packageSpec"] },
		install_from_package_json: { allowed: ["save", "saveDev"], required: [] },
		list: { allowed: [], required: [] },
	} as const;
	const rule = rules[data.operation];
	validateOperationFields(data, ctx, rule.allowed, rule.required);
});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxPackagesTool: ToolFactory<Input, Services> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Manage sandbox packages",
	description: "Install npm packages, install a workspace package.json, or list installed packages.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
	metadata: { category: "sandbox", icon: "package" },
	execute: (input, context) => executeSandboxOperation(
		services.sandboxRuntime,
		TOOL_NAME,
		input.operation,
		context,
		(service, callContext) => service.packages(input as SandboxPackageRequest, callContext),
	),
});

toolRegistry.register(TOOL_NAME, createSandboxPackagesTool);
declare global { interface ToolTypeRegistry { [TOOL_NAME]: { input: Input; services: Services } } }
