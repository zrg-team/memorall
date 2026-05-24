import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import type { WebSearchMatch } from "../../interfaces/web-browser";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
	type WebToolServices,
} from "./web-tool-utils";

const TOOL_NAME = "web_find_in_page" as const;

const schema = z
	.object({
		sessionId: z.string().optional().describe("Active web session to search."),
		url: z
			.string()
			.url()
			.optional()
			.describe(
				"Open first, then search current page content. Use with no sessionId.",
			),
		browserMode: z
			.enum(["iframe", "tab", "window"])
			.optional()
			.describe("Open mode when no sessionId is provided."),
		pattern: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Text or regex pattern to find within the current rendered page.",
			),
		query: z
			.string()
			.min(1)
			.optional()
			.describe("Deprecated alias for `pattern`."),
		selector: z
			.string()
			.optional()
			.describe("Optional selector to limit find-in-page scope."),
		isRegex: z
			.boolean()
			.optional()
			.describe("Treat pattern as regular expression."),
		caseSensitive: z
			.boolean()
			.optional()
			.describe("Case-sensitive text matching (default false)."),
		maxMatches: z
			.number()
			.int()
			.optional()
			.describe("Maximum matches to return."),
		maxSnippetChars: z
			.number()
			.int()
			.optional()
			.describe("Max characters returned per match snippet."),
		timeoutMs: z
			.number()
			.int()
			.optional()
			.describe("Navigation/load timeout used when opening by URL."),
	})
	.refine((value) => Boolean(value.pattern || value.query), {
		message: "`pattern` is required.",
		path: ["pattern"],
	});

type Input = z.infer<typeof schema>;
type SearchResult = WebSearchMatch[];

export const createWebSearchTool: ToolFactory<Input, WebToolServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Find text or regex matches within the currently opened rendered page. This does not search the web or a search engine.",
	schema,
	execute: async (input) => {
		const webBrowser = requireWebBrowserService(services);
		let shouldCloseSession = false;
		let sessionId: string | undefined;
		try {
			const { session, disposable } = await webBrowser.getOrOpenSession({
				sessionId: input.sessionId,
				url: input.url,
				timeoutMs: Math.max(500, input.timeoutMs ?? 15_000),
				browserMode: input.browserMode,
			});
			sessionId = session.id;
			shouldCloseSession = disposable;
			const pattern = input.pattern ?? input.query;
			const selector = input.selector?.trim() || undefined;

			const matches: SearchResult = await webBrowser.searchInSessionHtml({
				sessionId: session.id,
				pattern: pattern!,
				selector,
				isRegex: input.isRegex ?? false,
				caseSensitive: input.caseSensitive ?? false,
				maxMatches: Math.max(1, Math.min(50, input.maxMatches ?? 10)),
				maxSnippetChars: Math.max(
					20,
					Math.min(2_000, input.maxSnippetChars ?? 180),
				),
			});

			const result = createWebResult({
				actionType: TOOL_NAME,
				success: true,
				sessionId: session.id,
				url: session.currentUrl,
				pattern,
				selector,
				matches,
				count: matches.length,
			});
			return result;
		} catch (error) {
			return createDefaultWebErrorResult(error);
		} finally {
			if (shouldCloseSession && sessionId) {
				await webBrowser.closeSession(sessionId);
			}
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebSearchTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebToolServices;
		};
	}
}
