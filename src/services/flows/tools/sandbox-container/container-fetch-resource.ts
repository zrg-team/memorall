import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_fetch_resource" as const;

const schema = z.object({
	url: z.string().url().describe("Resource URL to fetch."),
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
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerFetchResourceTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Fetch API/UI resources through container runtime. Auto-detects JSON vs HTML/text and returns status + body.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const result = await services.sandboxContainer.fetchResource({
			url: input.url,
			method: input.method ?? "GET",
			headers: input.headers,
			body: input.body,
			timeoutMs: input.timeoutMs ?? 15_000,
			responseType: input.responseType ?? "auto",
		});
		return JSON.stringify(result, null, 2);
	},
});

toolRegistry.register(TOOL_NAME, createContainerFetchResourceTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
