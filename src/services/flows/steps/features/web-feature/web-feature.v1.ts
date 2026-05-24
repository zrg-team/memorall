import { logError } from "../../../interfaces/logger";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import type { ActiveWebSessionInfo } from "../../../interfaces/web-browser";
import type { AllServices } from "../../../interfaces/tool";

const STEP_NAME = "web-feature" as const;
export const WEB_FEATURE_NAME = STEP_NAME;

export interface WebFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface WebFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface WebFeatureConfig {}

export type WebFeatureServices = Pick<AllServices, "webBrowser"> | undefined;

const SYSTEM_PROMPT_INSTRUCTION = `
# WEB TOOL FEATURE
You have access to a browser.

Use this feature when the agent needs to work with web pages, including:
- Open a URL in iframe (DOM mode) or tab/window mode (wide-access mode), then keep session.

## MODE GUIDELINES
- Use "iframe" when you need direct DOM actions: "query", "click", "input", "focus", and "scroll".
- Use "tab" or "window" when you only need wide web access (open/read/search/fallback) and can tolerate no DOM actions.
- If broad accessibility is required first, prefer "window" (fallback to "tab" when "window" is unavailable).
- In this environment, "tab" and "window" are equivalent for content access behavior; choose "window" for clarity when you want browser-window style execution.
- Read rendered HTML or read selected DOM elements.
- Search in rendered HTML/DOM content.
- Perform DOM operations (query/read/click/input/focus/scroll).
- Wait for navigation timing or selector state.

## AVAILABLE TOOLS
- web_open: open URL and keep a session.
- web_read: read rendered page (or selected DOM region).
- web_find_in_page: find text/regex matches inside the current rendered page content. It does not search the web or a search engine.
- web_dom_action: query DOM nodes, click, input text, read node details, focus, scroll.
- web_wait: wait for timeout or selector appear/disappear.

## SLOW PAGE HANDLING
- Some pages need extra time after web_open before their content appears because they are still loading, redirecting, or hydrating JavaScript.
- If web_read returns empty content, only navigation/login/redirect scaffolding, or content that is clearly incomplete for the requested task, call web_wait for a short delay, then retry web_read before deciding the page has no useful content.

## RECOMMENDED WORKFLOW
1. Use web_open with keepSession=true to create a session.
2. Use web_read or web_find_in_page to inspect content.
3. Use web_dom_action for field fill/click interactions.
4. Use web_wait after navigation-heavy UI actions.
5. Before reporting that a page has no relevant data, try at least one additional wait plus web_read cycle when the page may be slow or still loading.
`;

export const WEB_FEATURE_SYSTEM_PROMPT = SYSTEM_PROMPT_INSTRUCTION.trim();
const formatActiveWebSession = (session: ActiveWebSessionInfo): string => {
	if (!session.isOpen) {
		return "";
	}

	const lastAccessedAt = session.lastAccessedAt
		? `- lastAccessedAt: ${new Date(session.lastAccessedAt).toISOString()}`
		: "";
	const createdAt = session.createdAt
		? `- createdAt: ${new Date(session.createdAt).toISOString()}`
		: "";

	return `## CURRENT WEB SESSION
- requestedUrl: ${session.requestedUrl}
- currentUrl: ${session.currentUrl}
- title: ${session.title || "(no title)"}
 - mode: ${session.mode || "iframe"}
${lastAccessedAt}
${createdAt}`.trim();
};

export const WEB_FEATURE_TOOLS = [
	"web_open",
	"web_read",
	"web_find_in_page",
	"web_dom_action",
	"web_wait",
] as const;

export const WEB_FEATURE_DESCRIPTION =
	"Enable offscreen web tooling: open, read, search, DOM access, and wait.";

const definition = defineStep<
	WebFeatureInput,
	WebFeatureOutput,
	WebFeatureServices,
	WebFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services }) => {
		try {
			const tools = GraphBase.chat.addTool(input.tools, ...WEB_FEATURE_TOOLS);
			const activeSession =
				(await services?.webBrowser?.getActiveSessionInfo()) ?? {
					isOpen: false,
				};
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${WEB_FEATURE_SYSTEM_PROMPT}\n\n${formatActiveWebSession(activeSession)}`,
			);
			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[WEB_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error ? error.message : "Web feature step failed",
					],
				},
			};
		}
	},
});

type WebFeatureSpec = StepSpecFromDefinition<typeof definition>;
export const createWebFeatureStep: StepFactoryFromSpec<WebFeatureSpec> = (
	services: WebFeatureServices,
	config?: WebFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createWebFeatureStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: WebFeatureSpec;
	}
}
