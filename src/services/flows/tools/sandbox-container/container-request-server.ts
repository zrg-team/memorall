import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_request_server" as const;

const schema = z.object({
	port: z.number().int().min(1).max(65535).describe("Target server port."),
	path: z
		.string()
		.optional()
		.describe("Request path (default '/'). Supports query string."),
	method: z
		.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
		.optional()
		.describe("HTTP method (default GET)."),
	headers: z
		.record(z.string(), z.string())
		.optional()
		.describe("Optional request headers."),
	body: z.string().optional().describe("Optional request body string."),
	timeoutMs: z
		.number()
		.int()
		.min(1)
		.max(120_000)
		.optional()
		.describe("Request timeout in milliseconds (default 15000)."),
	responseType: z
		.enum(["auto", "json", "text", "html"])
		.optional()
		.describe("Response parser mode (default auto)."),
	maxBodyChars: z
		.number()
		.int()
		.min(128)
		.max(500_000)
		.optional()
		.describe("Maximum response body characters returned (default 100000)."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerRequestServerTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Request a started sandbox server endpoint and return structured API/HTML response details.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.requestServer({
			port: input.port,
			path: input.path ?? "/",
			method: input.method ?? "GET",
			headers: input.headers,
			body: input.body,
			timeoutMs: input.timeoutMs ?? 15_000,
			responseType: input.responseType ?? "auto",
		});

		const maxChars = input.maxBodyChars ?? 100_000;
		const body = result.body.slice(0, maxChars);

		return JSON.stringify(
			{
				actionType: "sandbox_api_result",
				port: result.port,
				path: input.path ?? "/",
				method: input.method ?? "GET",
				url: result.url,
				status: result.status,
				ok: result.ok,
				contentType: result.contentType,
				responseType: result.responseType,
				headers: result.headers,
				body,
				truncated: result.body.length > body.length,
				originalLength: result.body.length,
			},
			null,
			2,
		);
	},
});

toolRegistry.register(TOOL_NAME, createContainerRequestServerTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
