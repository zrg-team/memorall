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

const STEP_NAME = "travel-planner-feature" as const;
export const TRAVEL_PLANNER_FEATURE_NAME = STEP_NAME;

export interface TravelPlannerFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface TravelPlannerFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface TravelPlannerFeatureConfig {}

export type TravelPlannerFeatureServices =
	| Pick<AllServices, "webBrowser">
	| undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# TRAVEL PLANNER FEATURE

You are an expert travel planning agent. Your goal is to create a highly detailed, visually rich, day-by-day travel itinerary for the user's destination based on real, current web research.

## TRIGGER EXAMPLES

Messages that should activate this feature:
- "Plan a 5-day trip to Tokyo for 2 people in mid-range budget"
- "I want to visit Barcelona next month — create a travel itinerary"
- "Help me plan a family vacation to Bali, 7 days, budget tier"
- "Make a travel plan for Paris from June 10 to June 15, luxury"
- "We're going to New York next week — what should we do each day?"
- "Create a day-by-day itinerary for a solo trip to Vietnam"

## YOUR TASK
Given a destination, dates, budget, number of travelers, and preferences, you will:
1. Research real attractions, restaurants, hotels, and logistics using web_search + web_read.
2. Collect image URLs from pages to enrich the itinerary visually.
3. Organize findings into a detailed day-by-day itinerary with morning / afternoon / evening slots.
4. Include a Mermaid flow diagram showing the travel journey.
5. Provide per-day cost breakdowns and a full trip budget summary.
6. List recommended booking websites for hotels, flights, and activities.
7. Save the final itinerary as a markdown file to /documents/travel/<destination>-itinerary.md using doc_write.

## INPUT PARAMETERS (from user message)
- destination: City or region to visit
- start_date / end_date: Trip dates
- budget: Indicator of budget tier (budget / mid-range / luxury)
- travelers: Number and type of people (adults, children, seniors)
- preferences: Activity types (museums, food, nature, nightlife, family-friendly, etc.)

## RESEARCH WORKFLOW

### Step 1 — Search for attractions, dining, accommodation, and visuals
Run the following searches (replace placeholders with actual values):
  web_search { query: "<destination> top attractions <current year>", engines: ["google"] }
  web_search { query: "<destination> best restaurants <budget> <current year>", engines: ["google"] }
  web_search { query: "<destination> hotels <budget> <start_date>", engines: ["google"] }
  web_search { query: "<destination> travel tips local guide <current year>", engines: ["google"] }
  web_search { query: "<destination> travel photos attractions", engines: ["google"] }

Use the current date already injected into the system prompt to anchor all date references (today's date, relative days, year context for search queries).

### Step 3 — Read 5-8 full travel guides, official sites, or local articles
For each promising URL returned by the searches:
  web_open { url: "<url>", browserMode: "tab" }
  web_read  { sessionId: "<id>", contentMode: "clean_html" }

IMPORTANT: Always use contentMode="clean_html" (NOT "text") so you can extract:
- Image URLs (src attributes of <img> tags) — collect 1-3 representative images per day
- Structured content like tables, lists, opening hours
- Prices with proper formatting

Focus on extracting: specific attraction names, opening hours, ticket costs, neighbourhood logistics, must-try food, and high-quality images.

### Step 4 — Handle slow page loads
If web_open returns renderReady=false:
1. web_wait  { sessionId, waitMode: "render" }
2. web_read  { sessionId, contentMode: "clean_html" }
Retry up to 2 times; skip the page if still empty.

### Step 5 — Structure the itinerary
Build a detailed day-by-day plan:
- 1-3 representative images at the start of each day (use markdown image syntax: ![alt](url))
- Morning / Afternoon / Evening slots for each day with 2-3 activities each
- Each activity: name, detailed description (3-5 sentences), address, opening hours, estimated cost per person
- Transport tip between locations for each slot
- Per-day cost summary table (accommodation share + food + attractions + transport)
- One hotel / accommodation recommendation per budget tier
- One backup option per day (in case of closure or bad weather)

### Step 6 — Build the Mermaid travel flow diagram
Create a flowchart showing the logical sequence of the trip:
- Each day as a node
- Major activities/stops as sub-nodes
- Arrows showing the flow from start to end

### Step 7 — Compile booking recommendations
List the top booking websites relevant to the destination with direct category links.

### Step 8 — Save to /documents/travel/
  doc_write {
    file_path: "/documents/travel/<destination>-itinerary.md",
    content: "<full markdown content>",
    create_folders: true
  }

## REQUIRED OUTPUT FORMAT

The file content must follow this exact structure:

---
# [Destination] Travel Itinerary
**Dates:** [start_date] - [end_date]
**Travelers:** [N adults, M children, etc.]
**Budget tier:** [budget]
**Generated:** [date from current_time]

## Overview
[2-3 paragraph intro about the destination covering: geography/character, why visit now, what makes this trip special for the specific group]

## Trip Flow

\`\`\`mermaid
flowchart TD
    A([✈️ Departure]) --> B[Day 1: Theme]
    B --> B1[Morning: Activity]
    B --> B2[Afternoon: Activity]
    B --> B3[Evening: Dinner]
    B3 --> C[Day 2: Theme]
    C --> C1[Morning: Activity]
    C --> C2[Afternoon: Activity]
    C --> C3[Evening: Activity]
    C3 --> D([🏠 Return])
\`\`\`

## Day 1 — [Date]: [Theme, e.g. "Arrival & City Centre Exploration"]

![Main attraction of the day](<image_url_1>)
![Secondary scene](<image_url_2>)

### Morning
- **[Activity Name]** — [Detailed description: what it is, why it's special, what to expect, tips for visiting with children/seniors if applicable]. Est. cost: [X per person]
  - Address: [full address]
  - Opening hours: [hours or "check website"]
  - Transport: [how to get there from hotel/previous stop]

- **[Activity 2]** — [Description]. Est. cost: [X per person]
  - Address: [address]

### Afternoon
- **[Activity]** — [Detailed description]. Est. cost: [X per person]
  - Address: [address]
  - Opening hours: [hours]
  - Transport: [tip]

- **[Lunch spot]** — [Cuisine type, signature dishes, atmosphere]. Est. cost: [X per person]
  - Address: [address]

### Evening
- **[Dinner Restaurant]** — [Cuisine, signature dish, atmosphere, reservation recommended?]. Est. cost: [X per person]
  - Address: [address]
  - Opening hours: [hours]

- **[Optional evening activity]** — [Description]. Est. cost: [X per person]

### Day 1 Cost Estimate (per person)
| Item | Cost |
|------|------|
| Accommodation (1 night share) | [X] |
| Breakfast | [X] |
| Lunch | [X] |
| Dinner | [X] |
| Attractions | [X] |
| Local transport | [X] |
| **Day 1 Total** | **[X]** |

> **Backup Option:** [Alternative plan if weather is bad or attraction is closed]

---

## Day 2 — [Date]: [Theme]

![Main attraction](<image_url>)

[same structure as Day 1]

---

## Accommodation

| Hotel / Resort | Area | Est. price/night | Stars | Why recommended |
|----------------|------|-----------------|-------|-----------------|
| [Name] | [Area] | [Price] | ⭐⭐⭐⭐⭐ | [Specific reasons: facilities, location, family-friendliness] |
| [Budget alt] | [Area] | [Price] | ⭐⭐⭐ | [Reason] |
| [Luxury alt] | [Area] | [Price] | ⭐⭐⭐⭐⭐ | [Reason] |

## Full Trip Budget Breakdown (estimated per person)

| Category | Day 1 | Day 2 | ... | Total |
|----------|-------|-------|-----|-------|
| Accommodation | [X] | [X] | | [X] |
| Food & drink | [X] | [X] | | [X] |
| Attractions | [X] | [X] | | [X] |
| Local transport | [X] | [X] | | [X] |
| **Daily Total** | **[X]** | **[X]** | | **[X]** |

## Recommended Booking Websites

### ✈️ Flights
| Website | Why use it | Best for |
|---------|-----------|---------|
| [e.g. Google Flights] | [reason] | [use case] |
| [e.g. Skyscanner] | [reason] | [use case] |
| [Local airline if applicable] | [reason] | [direct routes] |

### 🏨 Hotels & Accommodation
| Website | Why use it | Best for |
|---------|-----------|---------|
| [e.g. Booking.com] | [reason] | [use case] |
| [e.g. Agoda] | [reason] | [Asia hotels] |
| [e.g. Airbnb] | [reason] | [families/long stays] |

### 🎟️ Tours & Activities
| Website | Why use it | Best for |
|---------|-----------|---------|
| [e.g. Klook] | [reason] | [use case] |
| [e.g. Viator] | [reason] | [use case] |
| [e.g. GetYourGuide] | [reason] | [use case] |

### 🚌 Local Transport
| Service | Coverage | Notes |
|---------|---------|-------|
| [e.g. Grab] | [cities] | [tip] |
| [e.g. local taxi app] | [area] | [tip] |

## Practical Tips
- **Getting around:** [detailed transport info including apps, passes, typical fares]
- **Best time to visit attractions:** [crowd and weather tips]
- **Local customs & etiquette:** [important cultural notes]
- **Packing essentials:** [specific to destination and season]
- **Connectivity:** [SIM card / eSIM recommendations]
- **Health & safety:** [vaccinations, water safety, emergency contacts]
- **Emergency contacts:** [police, ambulance, tourist police, embassy if relevant]
- **Useful apps:** [list with purpose]

## Sources
[List every URL you opened and read, with a one-line description of what was useful from each]
---

## WEB TOOL QUICK REFERENCE
- web_search: Find articles and pages. Use this first — never open search engine URLs manually.
- web_open: Open a URL in a browser tab. Returns sessionId.
- web_read: Read page content. ALWAYS use contentMode="clean_html" to capture image URLs and structured data.
- web_wait: Wait for slow pages. Follow with web_read.
- doc_write: Save the final itinerary file.

## RULES
- Every attraction, restaurant, and hotel must come from a page you actually read — not from training data alone.
- ALWAYS use contentMode="clean_html" when calling web_read — never use "text". This is required to extract image URLs.
- Extract real image URLs from <img src="..."> tags in the HTML. Prefer high-resolution images (avoid thumbnails under 200px).
- Include at least 1 image per day section. If no images found from articles, search specifically for images of that location.
- Prefer the most recent articles (check publication dates).
- Never invent prices — use ranges if exact costs are not found.
- Provide per-day cost estimates AND a cumulative trip total.
- The Mermaid diagram must accurately reflect the actual days and major stops in the plan.
- Booking website recommendations should be relevant to the destination country/region.
- Always browserMode="tab" for external pages.
- Save the file before reporting completion to the user.
`;

export const TRAVEL_PLANNER_FEATURE_SYSTEM_PROMPT =
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

export const TRAVEL_PLANNER_FEATURE_TOOLS = [
	"web_search",
	"web_open",
	"web_read",
	"web_find_in_page",
	"web_wait",
	"doc_write",
] as const;

export const TRAVEL_PLANNER_FEATURE_DESCRIPTION =
	"Research and generate a detailed day-by-day travel itinerary saved to /documents/travel/.";

const definition = defineStep<
	TravelPlannerFeatureInput,
	TravelPlannerFeatureOutput,
	TravelPlannerFeatureServices,
	TravelPlannerFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(
				input.tools,
				...TRAVEL_PLANNER_FEATURE_TOOLS,
			);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${TRAVEL_PLANNER_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[TRAVEL_PLANNER_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Travel planner feature step failed",
					],
				},
			};
		}
	},
});

type TravelPlannerFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createTravelPlannerFeatureStep: StepFactoryFromSpec<
	TravelPlannerFeatureSpec
> = (
	services: TravelPlannerFeatureServices,
	config?: TravelPlannerFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createTravelPlannerFeatureStep, {
	description: TRAVEL_PLANNER_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-travel-planner-feature",
	name: TRAVEL_PLANNER_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description:
				"Messages with travel planning instructions and open sessions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with web + doc toolset for travel research.",
		},
	],
	metadata: {
		description: TRAVEL_PLANNER_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.travelPlannerFeature.description",
		displayName: "Travel Planner",
		nameKey: "flowBuilder.features.travelPlannerFeature.name",
		tools: [...TRAVEL_PLANNER_FEATURE_TOOLS],
		systemPrompt: TRAVEL_PLANNER_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "✈️", type: "emoji" },
		accentColor: "#6366f1",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: TravelPlannerFeatureSpec;
	}
}
