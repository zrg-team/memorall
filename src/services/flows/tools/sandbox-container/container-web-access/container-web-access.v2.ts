import z from "zod";
import type { AllServices, Tool, ToolFactory } from "../../../interfaces/tool";
import { toolRegistry } from "../../../tool-registry";
import type { SandboxHandleSwRequestResult } from "../../../interfaces/sandbox";

const TOOL_NAME = "container_web_access_v2" as const;
const DEFAULT_TIMEOUT_MS = 120_000;

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
			"REQUIRED true for any web UI server page (Vite, Next.js, Express HTML page, React SPA, etc.). " +
				"The iframe renderer waits for the page to fully load before capturing HTML. " +
				"Set false or omit ONLY for API-style endpoints that return JSON or plain text.",
		),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.max(300_000)
		.optional()
		.describe("Maximum wait time for the renderer iframe before failing."),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "sandboxContainer">;

interface VirtualSandboxLocation {
	port: number;
	path: string;
}

interface RendererReadyMessage {
	type: "virtual-renderer-ready";
	renderId: string;
	html?: string;
}

interface SwRelayRequestMessage {
	type: "sw-relay-request";
	id: number;
	portNum: number;
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: ArrayBuffer | null;
}

interface SwRelayResponseMessage {
	type: "sw-relay-response";
	id: number;
	data?: SandboxHandleSwRequestResult;
	error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isRendererReadyMessage = (
	value: unknown,
): value is RendererReadyMessage => {
	if (!isRecord(value)) {
		return false;
	}

	return (
		value.type === "virtual-renderer-ready" &&
		typeof value.renderId === "string"
	);
};

const isSwRelayRequestMessage = (
	value: unknown,
): value is SwRelayRequestMessage => {
	if (!isRecord(value)) {
		return false;
	}

	return (
		value.type === "sw-relay-request" &&
		typeof value.id === "number" &&
		typeof value.portNum === "number" &&
		typeof value.method === "string" &&
		typeof value.url === "string"
	);
};

const parseVirtualSandboxUrl = (
	rawUrl: string,
): VirtualSandboxLocation | null => {
	const parsePath = (
		pathname: string,
		suffix: string,
	): VirtualSandboxLocation | null => {
		const match = pathname.match(/^\/__virtual__\/(\d+)(\/.*)?$/);
		if (!match) {
			return null;
		}

		return {
			port: Number(match[1]),
			path: `${match[2] || "/"}${suffix}`,
		};
	};

	if (rawUrl.startsWith("/__virtual__/")) {
		return parsePath(rawUrl, "");
	}

	try {
		const parsed = new URL(rawUrl);
		return parsePath(parsed.pathname, `${parsed.search}${parsed.hash}`);
	} catch {
		return null;
	}
};

const parseServerUrl = (rawUrl: string): VirtualSandboxLocation | null => {
	const virtualTarget = parseVirtualSandboxUrl(rawUrl);
	if (virtualTarget) {
		return virtualTarget;
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

const renderSandboxPage = async (
	services: Services,
	input: Input,
	target: VirtualSandboxLocation,
): Promise<{
	url: string;
	html: string;
}> => {
	if (typeof document === "undefined" || typeof window === "undefined") {
		throw new Error("container_web_access_v2 requires DOM APIs.");
	}

	const sandboxContainer = services.sandboxContainer;
	if (!sandboxContainer) {
		throw new Error("Sandbox container is not available.");
	}

	const renderUrl = await sandboxContainer.getServerRenderUrl({
		port: target.port,
		path: target.path,
	});

	const renderId = Math.random().toString(36).slice(2, 10);
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	return new Promise<{ url: string; html: string }>((resolve, reject) => {
		const iframe = document.createElement("iframe");
		iframe.style.cssText =
			"position:fixed;top:-9999px;left:-9999px;width:1280px;height:800px;opacity:0;pointer-events:none;";
		iframe.name = renderId;

		let settled = false;
		let timeoutId = 0;

		const cleanup = (): void => {
			window.removeEventListener("message", onMessage);
			window.clearTimeout(timeoutId);
			iframe.remove();
		};

		const settleResolve = (html: string): void => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve({
				url: input.url,
				html,
			});
		};

		const settleReject = (error: Error): void => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		};

		const onMessage = (event: MessageEvent<unknown>): void => {
			if (event.source !== iframe.contentWindow) {
				return;
			}

			const eventData = event.data;

			if (
				isRendererReadyMessage(eventData) &&
				eventData.renderId === renderId
			) {
				settleResolve(eventData.html ?? "");
				return;
			}

			if (!isSwRelayRequestMessage(eventData)) {
				return;
			}

			if (!sandboxContainer.handleSwRequestWithRetry) {
				return;
			}

			void sandboxContainer
				.handleSwRequestWithRetry({
					id: eventData.id,
					port: eventData.portNum,
					method: eventData.method,
					path: eventData.url,
					headers: eventData.headers ?? {},
					body: eventData.body ?? null,
				})
				.then((result) => {
					const response: SwRelayResponseMessage = {
						type: "sw-relay-response",
						id: eventData.id,
						data: result,
					};
					iframe.contentWindow?.postMessage(response, "*");
				})
				.catch((error: unknown) => {
					const response: SwRelayResponseMessage = {
						type: "sw-relay-response",
						id: eventData.id,
						error: error instanceof Error ? error.message : String(error),
					};
					iframe.contentWindow?.postMessage(response, "*");
				});
		};

		window.addEventListener("message", onMessage);
		timeoutId = window.setTimeout(() => {
			settleReject(
				new Error(
					`Timed out after ${timeoutMs}ms while rendering sandbox URL: ${input.url}`,
				),
			);
		}, timeoutMs);

		document.body.appendChild(iframe);
		iframe.src = renderUrl.url;
	});
};

const requestSandboxServer = async (
	services: Services,
	input: Input,
	target: VirtualSandboxLocation,
): Promise<string> => {
	const sandboxContainer = services.sandboxContainer;
	if (!sandboxContainer) {
		throw new Error("Sandbox container is not available.");
	}

	const result = await sandboxContainer.requestServer({
		port: target.port,
		path: target.path,
		method: input.method,
		headers: input.headers,
		body: input.body,
		timeoutMs: input.timeoutMs,
		useIframe: false,
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
};

export const createContainerWebAccessV2Tool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Access a running sandbox container server. " +
		"Set useIframe=true to render web UI pages in the current thread and return rendered HTML. " +
		"Omit useIframe (or set false) only for API-style endpoints and return the API response body.",
	schema,
	execute: async (input) => {
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
			if (!input.useIframe) {
				return await requestSandboxServer(services, input, target);
			}

			const result = await renderSandboxPage(services, input, target);
			return JSON.stringify(
				{
					actionType: "web_access",
					success: true,
					requestedUrl: input.url,
					url: result.url,
					port: target.port,
					requestedPath: target.path,
					html: result.html,
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

toolRegistry.register(TOOL_NAME, createContainerWebAccessV2Tool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
