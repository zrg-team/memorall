import { z } from "zod";
import type {
	Tool,
	ToolFactory,
} from "../../interfaces/engine/tool.js";
import type { SandboxNetworkRequest } from "../../interfaces/services/agent-sandbox.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import {
	executeSandboxOperation,
	SANDBOX_TOOL_OUTPUT_SCHEMA,
	validateOperationFields,
} from "./tool-utils.js";

const TOOL_NAME = "sandbox_network" as const;
const schema = z
	.object({
		operation: z.literal("fetch"),
		url: z.string().url(),
		method: z
			.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
			.optional(),
		headers: z.record(z.string(), z.string()).optional(),
		body: z.string().optional(),
		timeoutMs: z.number().int().min(10).max(120_000).optional(),
		responseType: z.enum(["auto", "json", "text", "html"]).optional(),
		maxChars: z.number().int().min(1).max(200_000).optional(),
	})
	.strict()
	.superRefine((data, ctx) => {
		validateOperationFields(
			data,
			ctx,
			[
				"url",
				"method",
				"headers",
				"body",
				"timeoutMs",
				"responseType",
				"maxChars",
			],
			["url"],
		);
	});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxNetworkTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Fetch from sandbox",
	description:
		"Fetch an HTTP or HTTPS resource from inside the active sandbox runtime.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: {
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	metadata: { category: "sandbox", icon: "globe" },
	execute: (input, context) => {
		const { operation: _operation, ...request } = input;
		return executeSandboxOperation(
			services.sandboxRuntime,
			TOOL_NAME,
			input.operation,
			context,
			(service, callContext) =>
				service.network(request as SandboxNetworkRequest, callContext),
		);
	},
});

toolRegistry.register(TOOL_NAME, createSandboxNetworkTool);
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
