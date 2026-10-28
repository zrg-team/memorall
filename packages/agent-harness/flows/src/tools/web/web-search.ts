import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/engine/tool.js";
import type { WebSearchMatch } from "../../interfaces/services/web-browser.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import {
	optionalWebString,
	optionalWebUrl,
	optionalToolField,
	optionalToolChoice,
	optionalToolInteger,
	optionalToolBoolean,
	withWebSessionTarget,
} from "./web-input.js";
import {
	findInText,
	isFileSession,
	saveSessionFile,
	type WebResourceServices,
	webFileFields,
} from "./web-resource.js";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
	resolveWebBlock,
	webBlockFields,
} from "./web-tool-utils.js";

const TOOL_NAME = "web_find_in_page" as const;

const findInPageSchema = withWebSessionTarget(
	z
		.object({
			sessionId: optionalWebString().describe("Active web session to search."),
			url: optionalWebUrl().describe(
				"Open first, then search current page content. Use with no sessionId.",
			),
			browserMode: optionalToolChoice(["iframe", "tab", "window"]).describe(
				"Open mode when no sessionId is provided. Leave it out for a window; `iframe` only for a local server.",
			),
			pattern: optionalToolField(z.string().min(1)).describe(
				"Text or regex pattern to find within the current rendered page.",
			),
			query: optionalToolField(z.string().min(1)).describe(
				"Deprecated alias for `pattern`.",
			),
			selector: optionalWebString().describe(
				"Optional selector to limit find-in-page scope.",
			),
			isRegex: optionalToolBoolean().describe(
				"Treat pattern as regular expression.",
			),
			caseSensitive: optionalToolBoolean().describe(
				"Case-sensitive text matching (default false).",
			),
			maxMatches: optionalToolInteger().describe("Maximum matches to return."),
			maxSnippetChars: optionalToolInteger().describe(
				"Max characters returned per match snippet.",
			),
			timeoutMs: optionalToolInteger().describe(
				"Navigation/load timeout used when opening by URL.",
			),
		})
		.refine((value) => Boolean(value.pattern || value.query), {
			message: "`pattern` is required.",
			path: ["pattern"],
		}),
);

const schema = z.preprocess((input) => {
	if (typeof input !== "object" || input === null || Array.isArray(input))
		return input;
	const value = input as Record<string, unknown>;
	if (typeof value.pattern !== "string" || !value.pattern.trim()) return input;
	const { query: _query, ...canonicalInput } = value;
	return canonicalInput;
}, findInPageSchema);

type Input = z.infer<typeof schema>;
type SearchResult = WebSearchMatch[];

export const createWebSearchTool: ToolFactory<Input, WebResourceServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Find text or regex matches within the currently opened rendered page. This does not search the web or a search engine.",
	schema,
	execute: async (input, context) => {
		const webBrowser = requireWebBrowserService(services);
		let shouldCloseSession = false;
		let sessionId: string | undefined;
		try {
			const { session: opened, disposable } = await webBrowser.getOrOpenSession(
				{
					sessionId: input.sessionId,
					url: input.url,
					timeoutMs: Math.max(500, input.timeoutMs ?? 15_000),
					browserMode: input.browserMode,
				},
			);
			sessionId = opened.id;
			shouldCloseSession = disposable;

			// Searching a wall finds nothing and reports success, which reads exactly
			// like a page that genuinely lacks the text.
			const session = await resolveWebBlock(services, opened, {
				tool: TOOL_NAME,
				toolCallId: context?.toolCallId,
			});
			if (session.block) {
				shouldCloseSession = false;
			}
			const pattern = input.pattern ?? input.query;
			const selector = input.selector?.trim() || undefined;
			const searchOptions = {
				pattern: pattern!,
				isRegex: input.isRegex ?? false,
				caseSensitive: input.caseSensitive ?? false,
				maxMatches: Math.max(1, Math.min(50, input.maxMatches ?? 10)),
				maxSnippetChars: Math.max(
					20,
					Math.min(2_000, input.maxSnippetChars ?? 180),
				),
			};

			// A PDF's viewer has no text in its DOM: search the file's own text.
			if (isFileSession(session)) {
				const file = await saveSessionFile(services, session);
				const matches = findInText(file.text ?? "", searchOptions);
				const { file: fileInfo } = webFileFields(file, 0);
				return createWebResult({
					actionType: TOOL_NAME,
					success: true,
					sessionId: session.id,
					url: session.currentUrl,
					pattern,
					matches,
					count: matches.length,
					file: fileInfo,
					hint: file.text
						? `This page is a file (${file.mimeType}); the matches come from its text.`
						: `This page is a file (${file.mimeType}) with no text this tool can read.`,
				});
			}

			const matches: SearchResult = await webBrowser.searchInSessionHtml({
				sessionId: session.id,
				selector,
				...searchOptions,
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
				...webBlockFields(session),
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
			services: WebResourceServices;
		};
	}
}
