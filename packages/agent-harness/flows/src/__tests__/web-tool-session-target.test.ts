/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
	parseToolInput,
	ToolInputError,
} from "../interfaces/engine/tool-input.js";
import type { WebSession } from "../interfaces/services/web-browser.js";
import { createWebReadTool } from "../tools/web/web-read.js";
import { createWebSearchTool } from "../tools/web/web-search.js";
import { createWebWaitTool } from "../tools/web/web-wait.js";
import type { WebToolServices } from "../tools/web/web-tool-utils.js";
import { setHtmlParser } from "../utils/html-parser.js";

setHtmlParser((html) => new DOMParser().parseFromString(html, "text/html"));

const session: WebSession = {
	id: "91dc21cc-b050-47b0-af52-b9246f28fb71",
	requestedUrl: "https://example.test/article",
	currentUrl: "https://example.test/article",
	title: "FTS5 documentation",
	html: "<p>FTS5 supports atomic upsert operations.</p>",
	text: "FTS5 supports atomic upsert operations.",
	domAccessible: true,
	mode: "window",
	createdAt: 0,
	lastAccessedAt: 0,
};

const harness = (disposable = false) => {
	const webBrowser = {
		getOrOpenSession: vi.fn(async () => ({ session, disposable })),
		searchInSessionHtml: vi.fn(async () => []),
		waitForPageRender: vi.fn(async () => ({
			matched: true,
			html: session.html,
			lastText: session.text,
		})),
		refreshSession: vi.fn(async () => session),
		closeSession: vi.fn(async () => {}),
	};
	return {
		webBrowser,
		services: { webBrowser } as unknown as WebToolServices,
	};
};

describe.each([
	{ name: "web_read", create: createWebReadTool, args: {} },
	{
		name: "web_find_in_page",
		create: createWebSearchTool,
		args: { pattern: "FTS5|atomic|unchanged|upsert|strict", query: "FTS5" },
	},
	{ name: "web_wait", create: createWebWaitTool, args: {} },
])("$name session targets", ({ create, args }) => {
	it.each([undefined, null, "", "   "])(
		"reuses the existing session with url=%j",
		async (url) => {
			const { services, webBrowser } = harness();
			const tool = create(services);
			const input = tool.schema.parse({
				...args,
				sessionId: session.id,
				url,
				browserMode: "window",
				selector: "",
				timeoutMs: 15_000,
				maxHtmlChars: 500_000,
				contentMode: "text",
				isRegex: true,
				caseSensitive: false,
				maxMatches: 10,
				maxSnippetChars: 350,
			});

			const result = JSON.parse((await tool.execute(input)) as string);

			expect(result).toMatchObject({ success: true, sessionId: session.id });
			expect(webBrowser.getOrOpenSession).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ sessionId: session.id, url: undefined }),
			);
			expect(webBrowser.closeSession).not.toHaveBeenCalled();
		},
	);

	it.each([undefined, null, "", "   "])(
		"opens by URL with sessionId=%j and closes the disposable session",
		async (sessionId) => {
			const { services, webBrowser } = harness(true);
			const tool = create(services);
			const input = parseToolInput<Parameters<typeof tool.execute>[0]>(
				tool.schema,
				{ ...args, sessionId, url: session.currentUrl },
				tool.name,
			);

			const result = JSON.parse((await tool.execute(input)) as string);

			expect(result.success).toBe(true);
			expect(webBrowser.getOrOpenSession).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ url: session.currentUrl }),
			);
			expect(webBrowser.closeSession).toHaveBeenCalledExactlyOnceWith(
				session.id,
			);
		},
	);

	it("rejects calls with neither a session nor a URL", () => {
		const { services, webBrowser } = harness();
		const tool = create(services);

		for (const sessionId of [undefined, null, "", "   "]) {
			for (const url of [undefined, null, "", "   "]) {
				expect(() =>
					parseToolInput(tool.schema, { ...args, sessionId, url }, tool.name),
				).toThrow("Either sessionId or url must be provided.");
			}
		}
		expect(webBrowser.getOrOpenSession).not.toHaveBeenCalled();
	});

	it("ignores unused navigation fields when reusing a session", () => {
		const { services } = harness();
		const tool = create(services);
		const input = {
			...args,
			sessionId: session.id,
			url: "not-a-url",
			browserMode: "unused",
		};
		expect(tool.schema.parse(input)).toMatchObject({ sessionId: session.id });
		expect(tool.schema.parse(input)).not.toHaveProperty("url");
		expect(input.url).toBe("not-a-url");
	});

	it("continues to reject malformed URLs when opening a new page", () => {
		const { services } = harness();
		const tool = create(services);

		expect(() =>
			parseToolInput(tool.schema, { ...args, url: "not-a-url" }, tool.name),
		).toThrow(ToolInputError);
	});
});
