import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";

const TOOL_NAME = "container_render_server" as const;

const schema = z.object({
	port: z.number().int().min(1).max(65535).describe("Target server port."),
	path: z
		.string()
		.optional()
		.describe("Optional render path inside server (default '/')."),
	timeoutMs: z
		.number()
		.int()
		.min(1)
		.max(120_000)
		.optional()
		.describe("Request timeout in milliseconds (default 60000)."),
	maxHtmlChars: z
		.number()
		.int()
		.min(256)
		.max(500_000)
		.optional()
		.describe("Maximum HTML characters returned (default 100000)."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

export const createContainerRenderServerTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Render a running sandbox web server page (Vite, Next.js, Express HTML) via an iframe and return the fully rendered HTML. Use this for ALL web UI page previews — never use container_request_server for this purpose.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const path = input.path ?? "/";
		try {
			const result = await services.sandboxContainer.requestServer({
				port: input.port,
				path,
				method: "GET",
				timeoutMs: input.timeoutMs ?? 60_000,
				responseType: "html",
				useIframe: true,
			});

			const maxChars = input.maxHtmlChars ?? 100_000;
			const html = result.body.slice(0, maxChars);

			return JSON.stringify(
				{
					actionType: "web_access",
					port: result.port,
					requestedPath: path,
					url: result.url,
					status: result.status,
					ok: result.ok,
					contentType: result.contentType,
					html,
					truncated: result.body.length > html.length,
					originalLength: result.body.length,
				},
				null,
				2,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return JSON.stringify(
				{
					actionType: "web_access",
					port: input.port,
					requestedPath: path,
					url: `http://127.0.0.1:${input.port}${path}`,
					error: message,
				},
				null,
				2,
			);
		}
	},
});

toolRegistry.register(TOOL_NAME, createContainerRenderServerTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
