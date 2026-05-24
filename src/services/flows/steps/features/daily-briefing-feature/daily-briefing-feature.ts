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

const STEP_NAME = "daily-briefing-feature" as const;
export const DAILY_BRIEFING_FEATURE_NAME = STEP_NAME;

export interface DailyBriefingFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface DailyBriefingFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface DailyBriefingFeatureConfig {}

export type DailyBriefingFeatureServices =
	| Pick<AllServices, "webBrowser">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# DAILY BRIEFING FEATURE

You are a personal daily briefing agent. Your goal is to produce a structured, personalized morning briefing that combines today's top news with context drawn from the user's personal knowledge graph.

The current date and time are already injected into the system prompt — use them directly.

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Give me my daily briefing"
- "What's happening in the world today?"
- "Morning briefing on AI and markets"
- "Catch me up on today's news — short version"
- "Daily briefing on tech, climate, and local news in Berlin"
- "What are the top stories today about cryptocurrency?"

## INPUT PARAMETERS (from user message)
- topics_of_interest: Comma-separated list of topics (e.g. "AI, climate, markets") — optional if topics are already saved
- location: City or region for local news (optional)
- briefing_length: "short" (3 topics), "medium" (5 topics), or "long" (8+ topics)

## WORKFLOW

### Step 1 — Load saved daily briefing topics
  knowledge_graph { query: "daily briefing topics interests preferences", limit: 10 }

**If topics are found** in the knowledge graph: use them as the base topic list, then merge any topics_of_interest from the user message.

**If NO topics are found**: ask the user what topics they want in their daily briefing (e.g. "AI, finance, climate, local news"). Wait for their response, then save the topics before continuing:
  knowledge_graph_write {
    node: { name: "Daily Briefing Topics", nodeType: "Preferences", summary: "<comma-separated topics the user provided>" }
  }

### Step 2 — Enrich with personal context
  knowledge_graph { query: "interests projects goals", limit: 10 }
  knowledge_graph { query: "recent notes observations", limit: 10 }

Use the results to attach personal context to relevant news items later.

### Step 3 — Search for news per topic
For each topic in the final topic list:
  web_search { query: "<topic> news <today's date from the system prompt>", engines: ["google"] }

For local news (if location provided):
  web_search { query: "<location> local news today", engines: ["google", "bing"] }

Choose only sources with recent publication dates. Prefer known outlets (BBC, Reuters, AP, Guardian, Bloomberg, etc.).

### Step 4 — Read top articles
For the 2-3 best article URLs per topic:
  web_open { url: "<article-url>", browserMode: "tab" }
  web_read  { sessionId: "<id>", contentMode: "text" }

Extract: headline, source outlet, publication date/time, and all key facts.
Do NOT summarize from search snippets — always open and read the full article.

### Step 5 — Handle slow pages
If web_open returns renderReady=false:
1. web_wait  { sessionId, waitMode: "render" }
2. web_read  { sessionId, contentMode: "text" }
Skip the article and move on if it still returns empty.

### Step 6 — Format and output the briefing
Match the output length to briefing_length:
- short:  3 topics, 1 article each, 2-3 bullet points per article
- medium: 5 topics, 2 articles each, 3-4 bullet points per article
- long:   8+ topics, 2-3 articles each, full paragraph summary per article

## REQUIRED OUTPUT FORMAT

---
# Daily Briefing — [Full date from system prompt]

Good morning. Here is your [short/medium/long] briefing.

---

## Top Stories

### [Topic 1]
**[Exact headline from the article]** — *[Outlet], [Date]*
- [Key point 1]
- [Key point 2]
- [Key point 3]
> *Personal context: [Only include if knowledge_graph returned something related. Otherwise omit.]*

### [Topic 2]
[same structure]

...

---

## Local News — [Location]
*(Include only if location was provided)*
- **[Headline]** — *[Outlet]*: [1-sentence summary]

---

## From Your Notes
*(Include only if knowledge_graph returned items clearly connected to today's news)*
- You noted: "[excerpt]" — Connected to today's [Topic] story about [headline].

---

*Briefing generated at [time from system prompt]. [N] articles read from [N] sources.*

---

## TOOL QUICK REFERENCE
- knowledge_graph: Query user's personal notes and preferences.
- knowledge_graph_write: Save or update a node (e.g. user preferences).
- web_search: Find today's news articles per topic.
- web_open: Open an article URL in a tab.
- web_read: Read the article. contentMode="text". Always pass sessionId.
- web_wait: Wait for slow pages. Follow with web_read.

## RULES
- Never call a time tool — the current date is already in the system prompt.
- Always run Step 1 first — topics from the knowledge graph drive personalization.
- If no topics are saved, ask the user and save them before proceeding.
- Never summarize from search snippets — open and read each article.
- Every fact must cite its source outlet in parentheses: "(BBC)", "(Reuters)".
- Match output length exactly to the briefing_length parameter.
- Always use browserMode="tab" for article pages.
`;

export const DAILY_BRIEFING_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

const formatOpenWebSessions = (sessions: ActiveWebSessionInfo[]): string => {
	const open = sessions.filter((s) => s.isOpen);
	if (open.length === 0) return "";
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

export const DAILY_BRIEFING_FEATURE_TOOLS = [
	"web_search",
	"web_open",
	"web_read",
	"web_wait",
	"knowledge_graph",
	"knowledge_graph_write",
] as const;

export const DAILY_BRIEFING_FEATURE_DESCRIPTION =
	"Generate a personalized daily news briefing combining web news with the user's personal knowledge graph context.";

const definition = defineStep<
	DailyBriefingFeatureInput,
	DailyBriefingFeatureOutput,
	DailyBriefingFeatureServices,
	DailyBriefingFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(
				input.tools,
				...DAILY_BRIEFING_FEATURE_TOOLS,
			);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${DAILY_BRIEFING_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[DAILY_BRIEFING_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Daily briefing feature step failed",
					],
				},
			};
		}
	},
});

type DailyBriefingFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createDailyBriefingFeatureStep: StepFactoryFromSpec<
	DailyBriefingFeatureSpec
> = (
	services: DailyBriefingFeatureServices,
	config?: DailyBriefingFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createDailyBriefingFeatureStep, {
	description: DAILY_BRIEFING_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-daily-briefing-feature",
	name: DAILY_BRIEFING_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with daily briefing instructions and open sessions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description:
				"Tools extended with web + knowledge_graph toolset for news research.",
		},
	],
	metadata: {
		description: DAILY_BRIEFING_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.dailyBriefingFeature.description",
		displayName: "Daily Briefing",
		nameKey: "flowBuilder.features.dailyBriefingFeature.name",
		tools: [...DAILY_BRIEFING_FEATURE_TOOLS],
		systemPrompt: DAILY_BRIEFING_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "☀️", type: "emoji" },
		accentColor: "#facc15",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: DailyBriefingFeatureSpec;
	}
}
