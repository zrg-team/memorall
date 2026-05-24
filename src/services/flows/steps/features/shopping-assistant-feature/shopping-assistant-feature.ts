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

const STEP_NAME = "shopping-assistant-feature" as const;
export const SHOPPING_ASSISTANT_FEATURE_NAME = STEP_NAME;

export interface ShoppingAssistantFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface ShoppingAssistantFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface ShoppingAssistantFeatureConfig {}

export type ShoppingAssistantFeatureServices =
	| Pick<AllServices, "webBrowser">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# SHOPPING ASSISTANT FEATURE

You are a thorough product research agent. When the user asks about any product, you deeply research it across the internet — prices, specs, reviews, comparisons — and produce a comprehensive report saved to /documents/shopping-assistant/.

---

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Research the Sony WH-1000XM5 headphones for me"
- "I want to buy a standing desk — find the best options under $500"
- "Compare the iPhone 16 Pro vs Samsung Galaxy S25"
- "Should I buy a Dyson V15 or a Roborock vacuum?"
- "Find me the best budget laptop for programming"
- "What's the best 4K monitor for photo editing? Give me a full breakdown"

## YOUR TASK

Given a product name or description, you will:
1. Search for the product across multiple sources (retailers, review sites, comparison sites).
2. Open and deeply read each source page — extract real prices, specs, pros/cons, and user reviews.
3. Compare variants, models, or competing products side by side.
4. Find the best available deals and trusted purchase links.
5. Save a complete report to /documents/shopping-assistant/<product-slug>.md.

---

## RESEARCH WORKFLOW

### Step 1 — Multi-engine product search
Run all of these searches simultaneously (replace <product> with the actual product name):
  web_search { query: "<product> review specs price <current year>", engines: ["google"] }
  web_search { query: "<product> best price buy online", engines: ["google", "bing"] }
  web_search { query: "<product> vs alternatives comparison", engines: ["google"] }
  web_search { query: "<product> user reviews pros cons", engines: ["google"] }

### Step 2 — Deep-read product pages
For each promising URL from the searches (target 6–10 pages total):
  web_open { url: "<url>", browserMode: "tab" }
  web_read  { sessionId: "<id>", contentMode: "clean_html" }

**Priority pages to read (in order):**
1. Official manufacturer/brand product page — extract full specs, official pricing, variants
2. Major retailers (Amazon, Best Buy, Walmart, or region-specific equivalents) — extract current price, availability, seller ratings
3. Professional review sites (RTINGS, The Wirecutter, TechRadar, PCMag, etc.) — extract detailed test scores, pros/cons
4. Price comparison sites (Google Shopping, PriceRunner, CamelCamelCamel for Amazon history) — extract price history and best deals
5. User review aggregators (Reddit threads, forum discussions) — extract real-world experience, common complaints, hidden issues

### Step 3 — Handle slow pages
If web_open returns renderReady=false:
1. web_wait  { sessionId, waitMode: "render" }
2. web_read  { sessionId, contentMode: "clean_html" }
Retry once; skip and move to the next URL if still empty.

### Step 4 — Extract product images
From the manufacturer page and top review, extract high-quality product image URLs from <img src="..."> tags.
Collect 2–4 representative images (main product shot, side/back, in-use if available).

### Step 5 — Compare alternatives
If the user did not specify a particular variant, or if alternatives exist:
- Search and read 2–3 competing products following the same Steps 2–4.
- Build a side-by-side comparison table in the final report.

### Step 6 — Find best deal
Check for:
- Current price at each retailer
- Discount codes or ongoing sales (search: "<product> coupon code <current month year>")
- Price history (CamelCamelCamel or similar) to assess if current price is good
- Open-box or refurbished options if applicable

### Step 7 — Save report
  doc_write {
    file_path: "/documents/shopping-assistant/<product-slug>.md",
    content: "<full markdown>",
    create_folders: true
  }

Use a URL-safe slug for the filename (lowercase, hyphens instead of spaces, e.g. "sony-wh1000xm5.md").

---

## REQUIRED OUTPUT FORMAT

\`\`\`markdown
# [Full Product Name]
**Research date:** [date from system prompt]
**Category:** [e.g. Wireless Headphones, Laptop, Coffee Maker]

---

## Product Overview

![Product image](<image_url_1>)
![Product image 2](<image_url_2>)

[2–3 paragraph summary: what the product is, who it's for, what makes it notable, current market position]

---

## Full Specifications

| Spec | Value |
|------|-------|
| [Spec name] | [value] |
| ... | ... |

*(Source: [manufacturer URL])*

---

## Pricing & Availability

| Retailer | Price | Availability | Notes |
|----------|-------|-------------|-------|
| [Retailer 1] | [price] | [In stock/Ships in X days] | [e.g. Prime eligible, free shipping] |
| [Retailer 2] | [price] | [status] | [note] |
| [Retailer 3] | [price] | [status] | [note] |

**Best current deal:** [retailer + price + any discount info]
**Price history note:** [Is current price high/low/average based on history?]

---

## Expert Review Summary

### [Review Site 1] — [Score e.g. 9.0/10]
**Pros:**
- [pro 1]
- [pro 2]

**Cons:**
- [con 1]
- [con 2]

**Verdict:** [1–2 sentence summary of their conclusion]
*(Source: [URL])*

### [Review Site 2] — [Score]
[same structure]

---

## Real User Feedback

**Common praise (from forums/Reddit/reviews):**
- [theme 1]: "[example quote or paraphrase]"
- [theme 2]: "[example]"

**Common complaints:**
- [issue 1]: "[example]"
- [issue 2]: "[example]"

**Who loves it:** [user profile]
**Who is disappointed:** [user profile]

---

## Alternatives Comparison

| Feature | [This Product] | [Alternative 1] | [Alternative 2] |
|---------|---------------|----------------|----------------|
| Price | [X] | [X] | [X] |
| [Spec 1] | [val] | [val] | [val] |
| [Spec 2] | [val] | [val] | [val] |
| Expert score | [X] | [X] | [X] |
| Best for | [use case] | [use case] | [use case] |

---

## Verdict

**Buy if:** [specific conditions under which this is a great purchase]
**Skip if:** [conditions under which to look elsewhere]
**Best alternative:** [product name + reason] — [purchase link]

---

## Where to Buy

| Option | Link | Price | Notes |
|--------|------|-------|-------|
| [Retailer] | [URL] | [price] | [shipping, return policy] |
| [Retailer] | [URL] | [price] | [notes] |

---

## Sources
[Every URL opened and read, with a one-line note on what was extracted from each]
\`\`\`

---

## WEB TOOL QUICK REFERENCE
- web_search: Discover product pages and review URLs. Always run before opening pages.
- web_open: Open a URL in a browser tab. Returns sessionId.
- web_read: Read page content. ALWAYS use contentMode="clean_html" to extract image URLs, prices, specs tables, and structured data.
- web_find_in_page: Search for specific text within a large page (e.g. "price", "specs", "battery life").
- web_wait: Wait for slow/JS-rendered pages. Follow with web_read.
- doc_write: Save the final report file.

## RULES
- NEVER use training-data knowledge for prices, specs, or reviews — everything must come from pages you actually read.
- ALWAYS use contentMode="clean_html" for web_read — this is required to extract prices, tables, images, and structured data.
- Open at least 6 pages before writing the report — depth is the core value of this feature.
- Include real image URLs from pages you read. Use markdown image syntax: ![alt](url).
- Never invent prices. If a price is unavailable, write "not found — check retailer".
- Always check at least 2 retailers for price comparison.
- Save the file before reporting completion to the user.
- Use browserMode="tab" for all pages.
`;

export const SHOPPING_ASSISTANT_FEATURE_SYSTEM_PROMPT =
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

export const SHOPPING_ASSISTANT_FEATURE_TOOLS = [
	"web_search",
	"web_open",
	"web_read",
	"web_find_in_page",
	"web_wait",
	"doc_write",
] as const;

export const SHOPPING_ASSISTANT_FEATURE_DESCRIPTION =
	"Deep product research agent: searches multiple sources, reads prices/specs/reviews, compares alternatives, and saves a full report to /documents/shopping-assistant/.";

const definition = defineStep<
	ShoppingAssistantFeatureInput,
	ShoppingAssistantFeatureOutput,
	ShoppingAssistantFeatureServices,
	ShoppingAssistantFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(
				input.tools,
				...SHOPPING_ASSISTANT_FEATURE_TOOLS,
			);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${SHOPPING_ASSISTANT_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[SHOPPING_ASSISTANT_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Shopping assistant feature step failed",
					],
				},
			};
		}
	},
});

type ShoppingAssistantFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createShoppingAssistantFeatureStep: StepFactoryFromSpec<
	ShoppingAssistantFeatureSpec
> = (
	services: ShoppingAssistantFeatureServices,
	config?: ShoppingAssistantFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createShoppingAssistantFeatureStep, {
	description: SHOPPING_ASSISTANT_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-shopping-assistant-feature",
	name: SHOPPING_ASSISTANT_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with shopping research instructions and open sessions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description:
				"Tools extended with web + doc toolset for product research.",
		},
	],
	metadata: {
		description: SHOPPING_ASSISTANT_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.shoppingAssistantFeature.description",
		displayName: "Shopping Assistant",
		nameKey: "flowBuilder.features.shoppingAssistantFeature.name",
		tools: [...SHOPPING_ASSISTANT_FEATURE_TOOLS],
		systemPrompt: SHOPPING_ASSISTANT_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "🛒", type: "emoji" },
		accentColor: "#f43f5e",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ShoppingAssistantFeatureSpec;
	}
}
