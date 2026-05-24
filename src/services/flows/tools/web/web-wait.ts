import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	createDefaultWebErrorResult,
	createWebResult,
	truncateContent,
	requireWebBrowserService,
	type WebToolServices,
} from "./web-tool-utils";

const TOOL_NAME = "web_wait" as const;

const schema = z.object({
	sessionId: z.string().optional().describe("Active web session ID."),
	url: z.string().url().optional().describe("Open first, then wait."),
	browserMode: z
		.enum(["iframe", "tab", "window"])
		.optional()
		.describe("Open mode when no sessionId is provided."),
	waitMode: z
		.enum(["render", "selector", "time"])
		.optional()
		.describe(
			"Wait mode. `render` waits for page snapshot stability, `selector` waits for a DOM selector state, `time` waits a fixed duration.",
		),
	selector: z.string().optional().describe("DOM selector to wait for."),
	state: z
		.enum(["present", "absent"])
		.optional()
		.describe("Selector visibility state."),
	timeoutMs: z.number().int().optional().describe("Total wait timeout."),
	intervalMs: z
		.number()
		.int()
		.optional()
		.describe(
			"Polling interval when waiting for render or selector stability.",
		),
	stabilityMs: z
		.number()
		.int()
		.optional()
		.describe("Stable unchanged duration required for `render` mode."),
	delayMs: z
		.number()
		.int()
		.optional()
		.describe("Fixed delay mode when no selector is provided."),
});

type Input = z.infer<typeof schema>;

const waitFixedDelay = async (delayMs: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, delayMs));

export const createWebWaitTool: ToolFactory<Input, WebToolServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Wait for page render stability, selector state, or a fixed time in a web session.",
	schema,
	execute: async (input) => {
		const webBrowser = requireWebBrowserService(services);
		let disposableSessionId: string | undefined;
		const maxChars = 160_000;
		const timeoutMs = Math.max(500, input.timeoutMs ?? 15_000);
		const intervalMs = Math.max(50, input.intervalMs ?? 250);
		const stabilityMs = Math.max(100, input.stabilityMs ?? 1_000);
		const delayMs = Math.max(50, input.delayMs ?? 1_000);
		try {
			const { session, disposable } = await webBrowser.getOrOpenSession({
				sessionId: input.sessionId,
				url: input.url,
				timeoutMs,
				browserMode: input.browserMode,
			});
			if (disposable) {
				disposableSessionId = session.id;
			}
			const waitMode =
				input.waitMode ??
				(input.selector ? "selector" : input.delayMs ? "time" : "render");

			if (waitMode === "selector" && !input.selector) {
				throw new Error("`selector` is required when waitMode=`selector`.");
			}
			if (waitMode === "selector" && !session.domAccessible) {
				throw new Error(
					"Current session cannot expose DOM for selector waits.",
				);
			}

			let result: { matched: boolean; html: string; lastText: string };
			if (waitMode === "selector") {
				result = await webBrowser.waitForDomSelector({
					sessionId: session.id,
					selector: input.selector!,
					state: input.state ?? "present",
					timeoutMs,
					intervalMs,
					maxHtmlChars: maxChars,
				});
			} else if (waitMode === "time") {
				await waitFixedDelay(delayMs);
				const refreshedSession = await webBrowser.refreshSession({
					sessionId: session.id,
					maxHtmlChars: maxChars,
					timeoutMs,
				});
				result = {
					matched: true,
					html: refreshedSession.html,
					lastText: refreshedSession.text,
				};
			} else {
				result = await webBrowser.waitForPageRender({
					sessionId: session.id,
					timeoutMs,
					intervalMs,
					stabilityMs,
					maxHtmlChars: maxChars,
				});
			}
			const latestSession = await webBrowser.refreshSession({
				sessionId: session.id,
				maxHtmlChars: maxChars,
				timeoutMs,
			});

			const output = createWebResult({
				actionType: "web_wait",
				success: true,
				sessionId: latestSession.id,
				url: latestSession.currentUrl,
				waitMode,
				matched: result.matched,
				html: truncateContent(result.html, maxChars),
				text: truncateContent(result.lastText, maxChars),
			});
			return output;
		} catch (error) {
			return createDefaultWebErrorResult(error);
		} finally {
			if (disposableSessionId) {
				await webBrowser.closeSession(disposableSessionId);
			}
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebWaitTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebToolServices;
		};
	}
}
