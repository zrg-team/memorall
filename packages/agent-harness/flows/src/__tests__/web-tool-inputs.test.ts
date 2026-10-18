import { describe, expect, it, vi } from "vitest";
import { createWebOpenTool } from "../tools/web/web-open.js";
import { createWebReadTool } from "../tools/web/web-read.js";
import { createWebSearchTool } from "../tools/web/web-search.js";
import { createWebWaitTool } from "../tools/web/web-wait.js";
import { createWebDomActionTool } from "../tools/web/web-dom.js";
import { createWebSearchEngineTool } from "../tools/web/web-search-engine.js";

const tools = {
	web_open: createWebOpenTool({}),
	web_read: createWebReadTool({}),
	web_find_in_page: createWebSearchTool({}),
	web_wait: createWebWaitTool({}),
	web_dom_action: createWebDomActionTool({}),
	web_search: createWebSearchEngineTool({}),
};

describe("web input normalization at the schema boundary", () => {
	it.each([
		{
			name: "web_open",
			input: {
				url: " https://example.test/ ",
				browserMode: "",
				timeoutMs: "",
				maxHtmlChars: null,
				keepSession: null,
			},
		},
		{
			name: "web_read",
			input: {
				sessionId: "s1",
				url: "",
				browserMode: "",
				contentMode: "",
				maxHtmlChars: "",
				timeoutMs: null,
				selector: " ",
			},
		},
		{
			name: "web_find_in_page",
			input: {
				sessionId: "s1",
				url: "",
				pattern: "term",
				query: "",
				selector: "",
				isRegex: "",
				caseSensitive: null,
				maxMatches: "",
				maxSnippetChars: null,
				timeoutMs: "",
			},
		},
		{
			name: "web_wait",
			input: {
				sessionId: "s1",
				url: null,
				waitMode: "",
				selector: " ",
				state: "",
				timeoutMs: "",
				intervalMs: null,
				stabilityMs: "",
				delayMs: null,
			},
		},
		{
			name: "web_dom_action",
			input: {
				sessionId: " s1 ",
				action: "scrollBottom",
				selector: "",
				index: "",
				value: null,
				maxResults: "",
			},
		},
		{
			name: "web_search",
			input: {
				query: "search term",
				engines: "",
				maxResultsPerEngine: null,
				timeoutMs: "",
			},
		},
	] as const)(
		"$name accepts blank optional fields directly",
		({ name, input }) => {
			expect(tools[name].schema.safeParse(input).success).toBe(true);
		},
	);

	it("accepts the exact reported find-in-page payload", () => {
		const pattern =
			"warm and relaxed, crisp and clear|Access to this page requires authorization|Last updated on";
		expect(
			tools.web_find_in_page.schema.parse({
				sessionId: "05e61679-cace-48b9-8293-5114640f09ac",
				url: "",
				browserMode: "window",
				pattern,
				query: pattern,
				selector: "",
				isRegex: true,
				caseSensitive: false,
				maxMatches: 4,
				maxSnippetChars: 250,
				timeoutMs: 15_000,
			}),
		).toMatchObject({ pattern, isRegex: true, maxMatches: 4 });
	});

	it("uses either search spelling without validating an unused blank alias", () => {
		expect(
			tools.web_find_in_page.schema.parse({
				sessionId: "s1",
				pattern: "",
				query: "actual term",
			}),
		).toMatchObject({ query: "actual term", pattern: undefined });
		for (const query of [null, "", { unused: true }]) {
			const parsed = tools.web_find_in_page.schema.parse({
				sessionId: "s1",
				pattern: "actual term",
				query,
			});
			expect(parsed.pattern).toBe("actual term");
			expect(parsed.query).toBeUndefined();
		}
	});

	it("accepts common control values without losing zero or false", () => {
		expect(
			tools.web_find_in_page.schema.parse({
				sessionId: "s1",
				pattern: "term",
				isRegex: "false",
				caseSensitive: false,
				maxMatches: "4.9",
				maxSnippetChars: 0,
			}),
		).toMatchObject({
			isRegex: false,
			caseSensitive: false,
			maxMatches: 4,
			maxSnippetChars: 0,
		});
		expect(
			tools.web_open.schema.parse({
				url: "https://example.test",
				keepSession: "false",
				browserMode: "WINDOW",
			}),
		).toMatchObject({ keepSession: false, browserMode: "window" });
	});

	it("keeps empty input text and significant whitespace", () => {
		for (const value of ["", "   ", " padded text "]) {
			expect(
				tools.web_dom_action.schema.parse({
					sessionId: "s1",
					action: "input",
					selector: "#name",
					value,
				}),
			).toHaveProperty("value", value);
		}
	});

	it("requires a target only for DOM actions that need one", () => {
		for (const action of ["query", "read", "scrollTop", "scrollBottom"]) {
			expect(
				tools.web_dom_action.schema.safeParse({
					sessionId: "s1",
					action,
					selector: "",
				}).success,
			).toBe(true);
		}
		for (const action of ["click", "input", "focus"]) {
			expect(() =>
				tools.web_dom_action.schema.parse({ sessionId: "s1", action }),
			).toThrow("selector");
		}
	});

	it("executes page-level DOM actions with the body default", async () => {
		const performDomAction = vi.fn(async () => ({ matched: true }));
		const tool = createWebDomActionTool({
			webBrowser: {
				refreshSession: async () => ({
					id: "s1",
					currentUrl: "https://example.test",
					domAccessible: true,
				}),
				performDomAction,
			},
		} as never);
		const result = JSON.parse(
			(await tool.execute(
				tool.schema.parse({
					sessionId: "s1",
					action: "scrollBottom",
					selector: "",
				}),
			)) as string,
		);
		expect(result.success).toBe(true);
		expect(performDomAction).toHaveBeenCalledWith(
			expect.objectContaining({ selector: "body", action: "scrollBottom" }),
		);
	});

	it("accepts both engine lists and comma-separated strings", () => {
		for (const engines of [["google", "bing"], "google,bing"]) {
			expect(
				tools.web_search.schema.parse({ query: "term", engines }),
			).toHaveProperty("engines", "google,bing");
		}
	});

	it.each([
		{ name: "web_open", input: { url: "not-a-url" } },
		{ name: "web_read", input: { url: "" } },
		{
			name: "web_find_in_page",
			input: { sessionId: "s1", pattern: "", query: null },
		},
		{ name: "web_dom_action", input: { sessionId: "", action: "query" } },
		{ name: "web_search", input: { query: " " } },
		{ name: "web_wait", input: { sessionId: "s1", waitMode: "invented-mode" } },
		{
			name: "web_open",
			input: { url: "https://example.test", keepSession: "maybe" },
		},
	] as const)(
		"$name still rejects unusable required or control values",
		({ name, input }) => {
			expect(tools[name].schema.safeParse(input).success).toBe(false);
		},
	);
});
