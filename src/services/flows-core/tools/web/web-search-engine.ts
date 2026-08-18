import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
	type WebToolServices,
} from "@/services/flows-core/tools/web/web-tool-utils";

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
		`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
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

type SearchFailureClassification =
	| "challenge"
	| "network"
	| "timeout"
	| "parse-empty"
	| "unknown";

const parseHtml = (html: string): Document =>
	new DOMParser().parseFromString(
		html || "<html><body></body></html>",
		"text/html",
	);

const extractText = (el: Element | null): string =>
	el?.textContent?.trim() ?? "";

const extractHref = (el: Element | null): string =>
	el?.getAttribute("href") ?? "";

type EngineParser = (
	doc: Document,
	max: number,
	searchUrl: string,
) => SearchResult[];

const normalizedResultUrl = (
	rawHref: string,
	searchUrl: string,
): string | null => {
	if (!rawHref || rawHref.startsWith("#")) return null;
	let candidate: URL;
	try {
		candidate = new URL(rawHref, searchUrl);
	} catch {
		return null;
	}
	for (const key of ["uddg", "q", "url", "target"]) {
		const redirected = candidate.searchParams.get(key);
		if (!redirected) continue;
		try {
			const decoded = new URL(redirected);
			if (decoded.protocol === "http:" || decoded.protocol === "https:") {
				candidate = decoded;
				break;
			}
		} catch {
			// Keep the original candidate when the parameter is not an absolute URL.
		}
	}
	if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
		return null;
	}
	candidate.hash = "";
	for (const key of [...candidate.searchParams.keys()]) {
		if (/^(?:utm_|ved$|ei$|source$|form$|cvid$)/i.test(key)) {
			candidate.searchParams.delete(key);
		}
	}
	return candidate.toString();
};

const ENGINE_PARSERS: Record<SupportedEngine, EngineParser> = {
	google: (doc, max, searchUrl) => {
		const results: SearchResult[] = [];
		const containers = doc.querySelectorAll("#search [data-hveid], #rso .g");
		for (const container of Array.from(containers)) {
			const titleEl = container.querySelector("h3");
			const linkEl = container.querySelector("a[href]");
			const snippetEl = container.querySelector(
				".VwiC3b, [data-sncf], [data-snf]",
			);
			const url = normalizedResultUrl(extractHref(linkEl), searchUrl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
			if (results.length >= max) break;
		}
		return results;
	},
	bing: (doc, max, searchUrl) => {
		const results: SearchResult[] = [];
		for (const container of Array.from(doc.querySelectorAll(".b_algo")).slice(
			0,
			max,
		)) {
			const titleEl = container.querySelector("h2 a");
			const snippetEl = container.querySelector(".b_caption p, .b_algoSlug");
			const url = normalizedResultUrl(extractHref(titleEl), searchUrl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
		}
		return results;
	},
	duckduckgo: (doc, max, searchUrl) => {
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
			const url = normalizedResultUrl(extractHref(titleEl), searchUrl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
			if (results.length >= max) break;
		}
		return results;
	},
	yahoo: (doc, max, searchUrl) => {
		const results: SearchResult[] = [];
		for (const container of Array.from(
			doc.querySelectorAll(".algo, .Sr"),
		).slice(0, max)) {
			const titleEl = container.querySelector("h3 a, h3.title a");
			const snippetEl = container.querySelector(".compText p, p.lh-16");
			const url = normalizedResultUrl(extractHref(titleEl), searchUrl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
			results.push({ title, url, snippet: extractText(snippetEl) });
		}
		return results;
	},
	brave: (doc, max, searchUrl) => {
		const results: SearchResult[] = [];
		for (const container of Array.from(
			doc.querySelectorAll(".snippet, [data-type='web']"),
		).slice(0, max)) {
			const titleEl = container.querySelector(".title, h3 a");
			const linkEl = container.querySelector("a.result-header, a[href]");
			const snippetEl = container.querySelector(".snippet-description, p");
			const url = normalizedResultUrl(extractHref(linkEl), searchUrl);
			const title = extractText(titleEl);
			if (!title || !url) continue;
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
	searchUrl: string,
): SearchResult[] => {
	const results: SearchResult[] = [];
	const seen = new Set<string>();
	for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
		const url = normalizedResultUrl(
			anchor.getAttribute("href") ?? "",
			searchUrl,
		);
		const title = anchor.textContent?.trim() ?? "";
		if (!url || new URL(url).hostname.includes(engineDomain)) continue;
		if (title.split(/\s+/).length < 3 || seen.has(url)) continue;
		seen.add(url);
		results.push({ title, url, snippet: "" });
		if (results.length >= max) break;
	}
	return results;
};

export const resolveWebSearchEngines = (
	engines: string | string[] | undefined,
): SupportedEngine[] => {
	if (
		!engines ||
		(typeof engines === "string" && engines.trim().length === 0)
	) {
		return ["duckduckgo", "brave", "bing"];
	}
	const parts = (Array.isArray(engines) ? engines : engines.split(","))
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.length > 0);
	if (parts.includes("all")) return [...SUPPORTED_ENGINES];
	const valid = parts.filter((e): e is SupportedEngine =>
		(SUPPORTED_ENGINES as readonly string[]).includes(e),
	);
	return valid.length > 0
		? [...new Set(valid)]
		: ["duckduckgo", "brave", "bing"];
};

const classifySearchFailure = (
	message: string,
): SearchFailureClassification => {
	if (
		/verify|captcha|challenge|access denied|forbidden|human|security check/i.test(
			message,
		)
	) {
		return "challenge";
	}
	if (/timeout|timed out/i.test(message)) return "timeout";
	if (/network|fetch|dns|connection|http \d{3}/i.test(message))
		return "network";
	return "unknown";
};

const challengeText = (text: string): boolean =>
	/(?:verify (?:that )?you are human|checking your browser|enable javascript and cookies|attention required|security verification|unusual traffic|access denied)/i.test(
		text.slice(0, 20_000),
	);

const mapConcurrent = async <T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> => {
	const results = new Array<R>(items.length);
	let next = 0;
	const run = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await worker(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
	);
	return results;
};

const schema = z.object({
	query: z.string().min(1).describe("The search query."),
	engines: z
		.string()
		.optional()
		.describe(
			`Comma-separated engines to search. Use "all" for all engines, or any combination of: ${SUPPORTED_ENGINES.join(", ")}. Default: "duckduckgo,brave,bing". Example: "google,bing".`,
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
		const engines = resolveWebSearchEngines(input.engines);
		const max = Math.max(1, Math.min(30, input.maxResultsPerEngine ?? 10));
		const timeout = Math.max(500, input.timeoutMs ?? 15_000);

		const engineResults: {
			engine: string;
			searchUrl: string;
			results: SearchResult[];
		}[] = [];
		const errors: {
			engine: string;
			error: string;
			classification: SearchFailureClassification;
		}[] = [];

		await mapConcurrent(engines, 2, async (engine) => {
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

				let html = session.html ?? "";
				let text = session.text ?? "";
				let doc = parseHtml(html);
				let results = ENGINE_PARSERS[engine](doc, max, searchUrl);
				if (results.length === 0) {
					results = universalFallback(
						doc,
						ENGINE_DOMAINS[engine],
						max,
						searchUrl,
					);
				}
				if (
					results.length === 0 &&
					session.domAccessible &&
					webBrowser.getCapabilities?.().canWaitForRender
				) {
					const settled = await webBrowser
						.waitForPageRender({
							sessionId: session.id,
							timeoutMs: Math.min(5_000, timeout),
							intervalMs: 200,
							stabilityMs: 500,
							maxHtmlChars: 200_000,
						})
						.catch(() => null);
					if (settled) {
						html = settled.html;
						text = settled.lastText;
						doc = parseHtml(html);
						results = ENGINE_PARSERS[engine](doc, max, searchUrl);
						if (results.length === 0) {
							results = universalFallback(
								doc,
								ENGINE_DOMAINS[engine],
								max,
								searchUrl,
							);
						}
					}
				}

				engineResults.push({ engine, searchUrl, results });
				if (results.length === 0) {
					const challenged = challengeText(text || extractText(doc.body));
					errors.push({
						engine,
						error: challenged
							? "Search engine returned an interactive verification page."
							: "Search page loaded but yielded no validated result links.",
						classification: challenged ? "challenge" : "parse-empty",
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				errors.push({
					engine,
					error: message,
					classification: classifySearchFailure(message),
				});
			} finally {
				if (sessionId) {
					await webBrowser.closeSession(sessionId).catch(() => {});
				}
			}
		});
		engineResults.sort(
			(left, right) =>
				engines.indexOf(left.engine as SupportedEngine) -
				engines.indexOf(right.engine as SupportedEngine),
		);
		const resultCount = engineResults.reduce(
			(total, entry) => total + entry.results.length,
			0,
		);

		return createWebResult({
			actionType: TOOL_NAME,
			success: resultCount > 0,
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
