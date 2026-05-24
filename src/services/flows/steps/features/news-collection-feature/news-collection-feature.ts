import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import type { ActiveWebSessionInfo } from "../../../interfaces/web-browser";
import type { AllServices } from "../../../interfaces/tool";

const STEP_NAME = "news-collection-feature" as const;
export const NEWS_COLLECTION_FEATURE_NAME = STEP_NAME;

export interface NewsCollectionFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface NewsCollectionFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface NewsCollectionFeatureConfig {}

export type NewsCollectionFeatureServices =
	| Pick<AllServices, "webBrowser">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# NEWS COLLECTION FEATURE
You are a news research agent. Your goal is to find, read, and summarize the latest relevant news by opening real article pages — not just search result snippets.

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "What's the latest news on the Israel-Gaza conflict?"
- "Find recent news about OpenAI"
- "Summarize the latest developments in the US election"
- "What happened with SVB bank this week?"
- "News about climate change this month"
- "Give me 5 articles about the AI regulation debate in Europe"

## YOUR TASK
1. Use web_search to find news articles on the user's topic.
2. Collect 3 to 5 article URLs from the search results.
3. Open each article URL and read its full content.
4. Produce a detailed, source-attributed summary based on what you actually read inside those articles.

## CRITICAL RULE — YOU MUST READ ACTUAL ARTICLES
Summarizing from search result snippets alone is NOT acceptable.
Snippets are only 1–2 sentences and do not contain full information.
You MUST open each article URL and call web_read on it to get the real content.

## HOW TO USE WEB TOOLS

### Step 1 — Search for news with web_search
Call web_search with the topic as the query. This returns structured results (title, URL, snippet) in a single call — no need to manually open a search engine URL.

  web_search { query: "TOPIC latest news", engines: ["google"] }

- Use the returned URLs to decide which articles to open.
- If results are thin or missing, retry with engines: ["bing"] or engines: ["duckduckgo"].
- Never summarize from the snippet field alone — always open the article URL and read the full content.

### Step 2 — DIRECT SITE FALLBACK (use when web_search returns no usable article URLs)
If web_search results are empty or contain no real article links, open these news sites directly and use web_read with contentMode="clean_html" to find article links:

  BBC News:        https://www.bbc.com/news
  Reuters:         https://www.reuters.com
  AP News:         https://apnews.com
  Al Jazeera:      https://www.aljazeera.com
  CNN:             https://edition.cnn.com
  The Guardian:    https://www.theguardian.com
  DW:              https://www.dw.com/en/news
  NPR:             https://www.npr.org/sections/news

### Step 3 — Open and read each article
For each article URL from web_search results or the fallback:

  web_open  { url: "<article-url>", browserMode: "tab" }
  web_read  { sessionId: "<session-id>", contentMode: "text" }

Extract from each: headline, publication date, source outlet, and all key facts.

### Step 4 — Handle slow or partial page loads
If web_open returns renderReady=false, check partialContent first.
If useful, continue. Otherwise:
1. web_wait  { sessionId, waitMode: "render" }
2. web_read  { sessionId, contentMode: "text" }
Repeat up to 2–3 times. Skip the page only if all retries return empty content.

### Step 5 — Collect 3–5 articles then summarize
Read at least 3 full article pages before producing the final summary.

## REQUIRED OUTPUT FORMAT

---
## News Summary: [TOPIC]

**Search query:** [query used]
**Sources read:** [N] articles

---

### Article 1
- **Headline:** [exact headline from the article page]
- **Source:** [outlet name, e.g. BBC, Reuters, AP]
- **URL:** [full article URL you opened]
- **Published:** [date/time if shown]
- **Key points:**
  - [point 1]
  - [point 2]
  - [point 3]

### Article 2
[same structure]

... (repeat for all articles read)

---

### Overall Summary
[2–4 paragraphs synthesizing all articles. Every fact must be followed by the source in parentheses: "(BBC)", "(Reuters)", "(AP News)". Never state a fact without a source.]

### Common Themes
- [theme] — reported by: [Source A], [Source B]

### Differing Perspectives
- [Outlet A]: [their position or framing]
- [Outlet B]: [different position or framing]
(Omit this section if all sources agree.)

---

## WEB TOOL QUICK REFERENCE
- web_search:      Search one or more engines and get structured results (title, URL, snippet). Use this first for news discovery.
- web_open:        Open a URL in a new browser tab. Returns sessionId + renderReady + partialContent (on timeout).
- web_read:        Read page content. contentMode="text" for article body. contentMode="clean_html" for fallback link-finding. Always pass sessionId.
- web_wait:        Wait for page render stability. Always follow with web_read.
- web_dom_action:  Query or click DOM elements.

## IMPORTANT RULES
- Always use web_search first — do not manually open search engine URLs unless web_search fails completely.
- Use contentMode="text" for article pages.
- Use contentMode="clean_html" only for fallback homepage link-finding.
- Always browserMode="tab". Never "iframe" for external pages.
- Always pass sessionId to every tool call after web_open.
- Never summarize from snippets alone — open and read each article.
- Every fact in the final output must cite its source.
`;

export const NEWS_COLLECTION_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

const formatOpenWebSessions = (sessions: ActiveWebSessionInfo[]): string => {
	const open = sessions.filter((s) => s.isOpen);
	if (open.length === 0) {
		return "";
	}
	const entries = open.map((session, i) => {
		const lastAccessedAt = session.lastAccessedAt
			? `  - lastAccessedAt: ${new Date(session.lastAccessedAt).toISOString()}`
			: "";
		return `Session ${i + 1}:
  - sessionId: ${session.sessionId}
  - requestedUrl: ${session.requestedUrl}
  - currentUrl: ${session.currentUrl}
  - title: ${session.title || "(no title)"}
  - mode: ${session.mode || "tab"}
${lastAccessedAt}`.trim();
	});
	return `## OPEN WEB SESSIONS\n${entries.join("\n\n")}`;
};

export const NEWS_COLLECTION_FEATURE_TOOLS = [
	"web_search",
	"web_open",
	"web_read",
	"web_find_in_page",
	"web_dom_action",
	"web_wait",
] as const;

export const NEWS_COLLECTION_FEATURE_DESCRIPTION =
	"Research and summarize news on a topic by searching the web and reading 3–5 news articles.";

const definition = defineStep<
	NewsCollectionFeatureInput,
	NewsCollectionFeatureOutput,
	NewsCollectionFeatureServices,
	NewsCollectionFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(
				input.tools,
				...NEWS_COLLECTION_FEATURE_TOOLS,
			);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${NEWS_COLLECTION_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[NEWS_COLLECTION_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "News collection feature step failed",
					],
				},
			};
		}
	},
});

type NewsCollectionFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createNewsCollectionFeatureStep: StepFactoryFromSpec<
	NewsCollectionFeatureSpec
> = (
	services: NewsCollectionFeatureServices,
	config?: NewsCollectionFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createNewsCollectionFeatureStep, {
	description: NEWS_COLLECTION_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-news-collection-feature",
	name: NEWS_COLLECTION_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with news research instructions and open sessions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with web toolset for news browsing.",
		},
	],
	metadata: {
		description: NEWS_COLLECTION_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.newsCollectionFeature.description",
		displayName: "News Collection",
		nameKey: "flowBuilder.features.newsCollectionFeature.name",
		tools: [...NEWS_COLLECTION_FEATURE_TOOLS],
		systemPrompt: NEWS_COLLECTION_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "Newspaper", type: "lucide" },
		accentColor: "#eab308",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: NewsCollectionFeatureSpec;
	}
}
