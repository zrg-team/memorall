import { z } from "zod";
import type {
	Tool,
	ToolFactory,
} from "../../interfaces/engine/tool.js";
import type { SandboxPreviewRequest } from "../../interfaces/services/agent-sandbox.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import {
	executeSandboxOperation,
	SANDBOX_TOOL_OUTPUT_SCHEMA,
	validateOperationFields,
} from "./tool-utils.js";

const TOOL_NAME = "sandbox_preview" as const;
const schema = z
	.object({
		operation: z.enum([
			"start",
			"restart",
			"stop",
			"list",
			"request",
			"render",
		]),
		projectDir: z.string().min(1).optional(),
		kind: z.enum(["express", "vite", "next", "auto"]).optional(),
		template: z
			.enum(["express", "vite-react", "next-pages", "next-app"])
			.optional(),
		port: z.number().int().min(1).max(65535).optional(),
		previewId: z.string().min(1).optional(),
		entryPath: z.string().min(1).optional(),
		hostname: z.string().min(1).optional(),
		path: z.string().optional(),
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
		const rules = {
			start: {
				allowed: [
					"projectDir",
					"kind",
					"template",
					"port",
					"entryPath",
					"hostname",
				],
				required: ["projectDir"],
			},
			restart: {
				allowed: [
					"projectDir",
					"kind",
					"template",
					"port",
					"entryPath",
					"hostname",
				],
				required: ["projectDir"],
			},
			stop: { allowed: ["previewId", "port"], required: [] },
			list: { allowed: [], required: [] },
			request: {
				allowed: [
					"previewId",
					"port",
					"path",
					"method",
					"headers",
					"body",
					"timeoutMs",
					"responseType",
					"maxChars",
				],
				required: [],
			},
			render: {
				allowed: [
					"previewId",
					"port",
					"path",
					"method",
					"headers",
					"body",
					"timeoutMs",
					"responseType",
					"maxChars",
				],
				required: [],
			},
		} as const;
		const rule = rules[data.operation];
		validateOperationFields(data, ctx, rule.allowed, rule.required);
		if (
			["stop", "request", "render"].includes(data.operation) &&
			data.previewId === undefined &&
			data.port === undefined
		) {
			ctx.addIssue({
				code: "custom",
				path: ["previewId"],
				message: "previewId or port is required",
			});
		}
	});
type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxRuntime">;

export const createSandboxPreviewTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	title: "Manage sandbox previews",
	description:
		"Start, restart, stop, list, request, or render browser sandbox web previews.",
	schema,
	outputSchema: SANDBOX_TOOL_OUTPUT_SCHEMA,
	annotations: { readOnlyHint: false, idempotentHint: false },
	metadata: { category: "sandbox", icon: "monitor-play" },
	execute: (input, context) =>
		executeSandboxOperation(
			services.sandboxRuntime,
			TOOL_NAME,
			input.operation,
			context,
			(service, callContext) =>
				service.preview(input as SandboxPreviewRequest, callContext),
			input.operation === "render"
				? (result) => ({
						ok: true,
						operation: input.operation,
						actionType: "web_access",
						result,
					})
				: undefined,
		),
});

toolRegistry.register(TOOL_NAME, createSandboxPreviewTool);
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
