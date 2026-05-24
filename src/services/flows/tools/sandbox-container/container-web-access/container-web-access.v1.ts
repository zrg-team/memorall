import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../../interfaces/tool";
import { toolRegistry } from "../../../tool-registry";

const TOOL_NAME = "container_web_access" as const;

const schema = z.object({
	url: z
		.string()
		.describe(
			"URL to access on the sandbox container server. Accepts: /__virtual__/<port>/path.",
		),
	method: z
		.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
		.default("GET")
		.describe("HTTP method (default: GET)."),
	body: z.string().optional().describe("Request body (for POST/PUT/PATCH)."),
	headers: z
		.record(z.string(), z.string())
		.optional()
		.describe("Additional request headers."),
	useIframe: z
		.boolean()
		.optional()
		.describe(
			"REQUIRED true for any web server UI page (Vite, Next.js, Express HTML, React, etc.). " +
				"The iframe renderer waits for the page to fully load before capturing HTML. " +
				"Set false or omit ONLY for pure API endpoints that return JSON or plain text — those use direct fetch.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

const parseServerUrl = (
	rawUrl: string,
): { port: number; path: string } | null => {
	const virtualMatch = rawUrl.match(
		/\/__virtual__\/(\d+)(\/[^?#]*)?([?#].*)?$/,
	);
	if (virtualMatch) {
		const port = Number(virtualMatch[1]);
		const path = `${virtualMatch[2] || "/"}${virtualMatch[3] || ""}`;
		if (!Number.isNaN(port)) return { port, path };
	}

	try {
		const parsed = new URL(rawUrl);
		const port = Number(parsed.port);
		if (!Number.isNaN(port) && port > 0) {
			return {
				port,
				path: `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`,
			};
		}
	} catch {
		// not a valid absolute URL
	}

	return null;
};

export const createContainerWebAccessTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Access a running sandbox container server. " +
		"Set useIframe=true to render web UI pages and return the rendered HTML. " +
		"Omit useIframe (or set false) to call API endpoints and return their response body.",
	schema,
	execute: async (input) => {
		if (!services.sandboxContainer) {
			return "Sanbox container is not avaible";
		}
		const target = parseServerUrl(input.url);
		if (!target) {
			return JSON.stringify(
				{
					actionType: "web_access",
					success: false,
					requestedUrl: input.url,
					error: `Cannot resolve a sandbox server port from URL: ${input.url}`,
				},
				null,
				2,
			);
		}

		try {
			const result = await services.sandboxContainer.requestServer({
				port: target.port,
				path: target.path,
				method: input.method,
				headers: input.headers,
				body: input.body,
				useIframe: input.useIframe,
			});

			return JSON.stringify(
				{
					actionType: "web_access",
					success: true,
					requestedUrl: input.url,
					url: result.url,
					status: result.status,
					ok: result.ok,
					contentType: result.contentType,
					responseType: result.responseType,
					body: result.body,
				},
				null,
				2,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return JSON.stringify(
				{
					actionType: "web_access",
					success: false,
					requestedUrl: input.url,
					error: message,
				},
				null,
				2,
			);
		}
	},
});

toolRegistry.register(TOOL_NAME, createContainerWebAccessTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
