import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
	type WebToolServices,
} from "./web-tool-utils";

const TOOL_NAME = "web_search" as const;

const SUPPORTED_ENGINES = [
	"google",
	"bing",
	"duckduckgo",
	"yahoo",
	"brave",
] as const;
type SupportedEngine = (typeof SUPPORTED_ENGINES)[number];

const ENGINE_URLS: Record<SupportedEngine, (q: string) => string> = {
	google: (q) =>
		`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en`,
	bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
	duckduckgo: (q) =>
		`https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`,
	yahoo: (q) => `https://search.yahoo.com/search?p=${encodeURIComponent(q)}`,
	brave: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
};

const ENGINE_DOMAINS: Record<SupportedEngine, string> = {
	google: "google.com",
	bing: "bing.com",
	duckduckgo: "duckduckgo.com",
	yahoo: "yahoo.com",
	brave: "brave.com",
};

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

const parseHtml = (html: string): Document =>
	new DOMParser().parseFromString(
		html || "<html><body></body></html>",
		"text/html",
	);

const extractText = (el: Element | null): string =>
	el?.textContent?.trim() ?? "";

const extractHref = (el: Element | null): string =>
	el?.getAttribute("href") ?? "";

type EngineParser = (doc: Document, max: number) => SearchResult[];

const ENGINE_PARSERS: Record<SupportedEngine, EngineParser> = {
	google: (doc, max) => {
		const results: SearchResult[] = [];
		const containers = doc.querySelectorAll("#search [data-hveid], #rso .g");
		for (const container of Array.from(containers)) {
			const titleEl = container.querySelector("h3");
			const linkEl = container.querySelector("a[href]");
			const snippetEl = container.querySelector(
				".VwiC3b, [data-sncf], [data-snf]",
			);
			const url = extractHref(linkEl);
			const title = extractText(titleEl);
			if (!title || !url || url.startsWith("#") || url.startsWith("/search"))
				continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
			if (results.length >= max) break;
		}
		return results;
	},
	bing: (doc, max) => {
		const results: SearchResult[] = [];
		for (const container of Array.from(doc.querySelectorAll(".b_algo")).slice(
			0,
			max,
		)) {
			const titleEl = container.querySelector("h2 a");
			const snippetEl = container.querySelector(".b_caption p, .b_algoSlug");
			const url = extractHref(titleEl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
		}
		return results;
	},
	duckduckgo: (doc, max) => {
		const results: SearchResult[] = [];
		const containers = doc.querySelectorAll(
			'[data-testid="result"], .result, .web-result',
		);
		for (const container of Array.from(containers)) {
			const titleEl = container.querySelector(
				'[data-testid="result-title-a"], .result__a, h2 a',
			);
			const snippetEl = container.querySelector(
				'[data-testid="result-snippet"], .result__snippet',
			);
			const url = extractHref(titleEl);
			const title = extractText(titleEl);
			if (!title || !url || url.startsWith("#")) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
			if (results.length >= max) break;
		}
		return results;
	},
	yahoo: (doc, max) => {
		const results: SearchResult[] = [];
		for (const container of Array.from(
			doc.querySelectorAll(".algo, .Sr"),
		).slice(0, max)) {
			const titleEl = container.querySelector("h3 a, h3.title a");
			const snippetEl = container.querySelector(".compText p, p.lh-16");
			const url = extractHref(titleEl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
		}
		return results;
	},
	brave: (doc, max) => {
		const results: SearchResult[] = [];
		for (const container of Array.from(
			doc.querySelectorAll(".snippet, [data-type='web']"),
		).slice(0, max)) {
			const titleEl = container.querySelector(".title, h3 a");
			const linkEl = container.querySelector("a.result-header, a[href]");
			const snippetEl = container.querySelector(".snippet-description, p");
			const url = extractHref(linkEl);
			const title = extractText(titleEl);
			if (!title || !url || url.startsWith("#")) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
		}
		return results;
	},
};

// Universal fallback: extract meaningful external links when engine-specific
// selectors yield no results (e.g. DOM structure changed or JS not rendered).
const universalFallback = (
	doc: Document,
	engineDomain: string,
	max: number,
): SearchResult[] => {
	const results: SearchResult[] = [];
	const seen = new Set<string>();
	for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
		const url = anchor.getAttribute("href") ?? "";
		const title = anchor.textContent?.trim() ?? "";
		if (!url.startsWith("http") || url.includes(engineDomain)) continue;
		if (title.split(/\s+/).length < 3 || seen.has(url)) continue;
		seen.add(url);
		results.push({ title, url, snippet: "" });
		if (results.length >= max) break;
	}
	return results;
};

const resolveEngines = (engines: string | undefined): SupportedEngine[] => {
	if (!engines || engines.trim().length === 0) return ["google"];
	const parts = engines
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0);
	if (parts.includes("all")) return [...SUPPORTED_ENGINES];
	const valid = parts.filter((e): e is SupportedEngine =>
		(SUPPORTED_ENGINES as readonly string[]).includes(e),
	);
	return valid.length > 0 ? valid : ["google"];
};

const schema = z.object({
	query: z.string().min(1).describe("The search query."),
	engines: z
		.string()
		.optional()
		.describe(
			`Comma-separated engines to search. Use "all" for all engines, or any combination of: ${SUPPORTED_ENGINES.join(", ")}. Default: "google". Example: "google,bing".`,
		),
	maxResultsPerEngine: z
		.number()
		.int()
		.optional()
		.describe("Max results to return per engine (default 10)."),
	timeoutMs: z
		.number()
		.int()
		.optional()
		.describe("Per-engine page load timeout in milliseconds (default 15000)."),
});

type Input = z.infer<typeof schema>;

export const createWebSearchEngineTool: ToolFactory<Input, WebToolServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Search one or more search engines (Google, Bing, DuckDuckGo, Yahoo, Brave) with a single query and get structured results — title, URL, snippet — per engine. Use this instead of manually opening a search engine URL and reading the page. Engines are queried sequentially.",
	schema,
	execute: async (input) => {
		const webBrowser = requireWebBrowserService(services);
		const engines = resolveEngines(input.engines);
		const max = Math.max(1, Math.min(30, input.maxResultsPerEngine ?? 10));
		const timeout = Math.max(500, input.timeoutMs ?? 15_000);

		const engineResults: {
			engine: string;
			searchUrl: string;
			results: SearchResult[];
		}[] = [];
		const errors: { engine: string; error: string }[] = [];

		for (const engine of engines) {
			const searchUrl = ENGINE_URLS[engine](input.query);
			let sessionId: string | undefined;
			try {
				const { session } = await webBrowser.openSession({
					url: searchUrl,
					timeoutMs: timeout,
					maxHtmlChars: 200_000,
					persist: false,
					mode: "tab",
				});
				sessionId = session.id;

				const doc = parseHtml(session.html ?? "");
				let results = ENGINE_PARSERS[engine](doc, max);
				if (results.length === 0) {
					results = universalFallback(doc, ENGINE_DOMAINS[engine], max);
				}

				engineResults.push({ engine, searchUrl, results });
			} catch (error) {
				errors.push({
					engine,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				if (sessionId) {
					await webBrowser.closeSession(sessionId).catch(() => {});
				}
			}
		}

		return createWebResult({
			actionType: TOOL_NAME,
			success: engineResults.length > 0,
			query: input.query,
			engines,
			results: engineResults,
			...(errors.length > 0 ? { errors } : {}),
		});
	},
});

toolRegistry.register(TOOL_NAME, createWebSearchEngineTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebToolServices;
		};
	}
}
