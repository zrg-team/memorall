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
You have access to browser-backed web tooling and offscreen iframe web tooling.

Multiple web sessions can be open simultaneously. Use sessionId to target a specific session.

## MODE GUIDELINES
- Prefer "tab" or "window" for general website access. They run against a real browser page and usually work on more websites than "iframe".
- Use "window" when you want dedicated browser-window execution. The runtime may fall back to "tab" if a separate window cannot be created.
- Use "iframe" only when embedded offscreen browsing is sufficient.
- Browser-backed "tab" and "window" modes support read, search, DOM actions, and selector waits through the content script.
- If a website is likely to reject iframe embedding or needs the real page context, choose "tab" or "window" first.

## SESSION RULES
- Multiple sessions can be open at once. Always pass the correct sessionId when operating on an existing session.
- Use web_open (with a url) to open a new session. Reuse an existing session by passing its sessionId without a url.
- If OPEN WEB SESSIONS are shown below, prefer reusing those sessions over opening new ones for the same URL.
- Never invent or guess a sessionId. Use only sessionIds from OPEN WEB SESSIONS or returned by web_open.
- Sessions auto-close after 10 minutes of inactivity — no need to close them manually.

## TIMEOUT AND PARTIAL LOAD HANDLING
- If web_open returns renderReady=false, the page may have timed out or still be loading.
- Use web_read immediately after a timeout to check what content is currently available.
- If partial content is sufficient, continue with it. If not, use web_wait with waitMode="render" to wait for the page to stabilize, then retry web_read.
- If web_read returns empty content, only navigation/login/redirect scaffolding, or content that is clearly incomplete for the requested task, assume the page may still be loading or hydrating. Call web_wait with waitMode="render" or waitMode="time" for a short delay, then retry web_read before deciding the page has no useful content.
- Only stop if repeated web_read attempts return no useful content.

## SELECTOR GUIDELINES
- Do not assume a selector when reading page content. If you are not confident about the page structure, read the page first without a selector or inspect/query DOM before narrowing to a selector.
- If a selector-based read returns empty or clearly incomplete content, do not assume the page has no content. Try another selector or inspect the DOM structure first.
- Prefer stable selectors such as semantic container IDs, "main", "article", or clearly relevant content regions when they are confirmed to exist.
- For form filling, first use web_dom_action with action="query" and a narrow selector, then choose a returned element where visible=true and acceptsTextInput=true.
- Use the returned index value exactly for follow-up read/click/input/focus actions. Do not use the row position if the list order changes.
- Do not type into input[type=file], hidden, submit, button, checkbox, radio, or other non-text inputs.

## AVAILABLE TOOLS
- web_open: open URL, wait for the initial navigation load, and keep a session.
- web_read: read rendered page (or selected DOM region). Default output is readable text.
- web_find_in_page: find text/regex matches inside the current rendered page content. It does not search the web or a search engine.
- web_dom_action: query DOM nodes, click, input text, read node details, focus, scroll.
- web_wait: wait for page render stability, a selector appear/disappear, or a fixed time delay.

## RECOMMENDED WORKFLOW
1. Use web_open with keepSession=true and prefer browserMode="tab" or browserMode="window" for most websites.
2. web_open waits for initial navigation and a default render-readiness check. Check the web_open result. If renderReady is false, the page may still be a JavaScript shell, still hydrating, or the load timed out.
3. If renderReady is false, use web_read to check current page content. If useful content is present, continue. If not, call web_wait with waitMode="render" before retrying web_read.
4. Use web_wait with waitMode="render" to wait until the page has stable readable content, waitMode="selector" when you know the target selector, or waitMode="time" for a fixed delay.
5. After web_open or web_wait, use web_read to retrieve page content. web_open is for session creation, not content retrieval.
6. Use web_dom_action for field fill, click, focus, and scroll interactions.
7. Use web_wait again after navigation-heavy UI actions or when waiting for specific selectors.
8. Keep using the same sessionId until the task on that page is complete.
9. For web_read with a selector, use only selectors you have already confirmed. If the result is empty, retry with a different confirmed selector instead of assuming the selector or page is correct.
10. Before reporting that a page has no relevant data, try at least one additional wait plus web_read cycle when the page may be slow, JavaScript-rendered, or still loading.
`;

export const WEB_FEATURE_SYSTEM_PROMPT = SYSTEM_PROMPT_INSTRUCTION.trim();
const formatOpenWebSessions = (sessions: ActiveWebSessionInfo[]): string => {
	const open = sessions.filter((s) => s.isOpen);
	if (open.length === 0) {
		return "";
	}
	const entries = open.map((session, i) => {
		const lastAccessedAt = session.lastAccessedAt
			? `  - lastAccessedAt: ${new Date(session.lastAccessedAt).toISOString()}`
			: "";
		const createdAt = session.createdAt
			? `  - createdAt: ${new Date(session.createdAt).toISOString()}`
			: "";
		return `Session ${i + 1}:
  - sessionId: ${session.sessionId}
  - requestedUrl: ${session.requestedUrl}
  - currentUrl: ${session.currentUrl}
  - title: ${session.title || "(no title)"}
  - mode: ${session.mode || "iframe"}
${lastAccessedAt}
${createdAt}`.trim();
	});
	return `## OPEN WEB SESSIONS\n${entries.join("\n\n")}`;
};

export const WEB_FEATURE_TOOLS = [
	"web_open",
	"web_read",
	"web_find_in_page",
	"web_dom_action",
	"web_wait",
] as const;

export const WEB_FEATURE_DESCRIPTION =
	"Enable browser-backed and offscreen web tooling for open, read, search, DOM actions, and waits.";

const definition = defineStep<
	WebFeatureInput,
	WebFeatureOutput,
	WebFeatureServices,
	WebFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runLifecycle }) => {
		try {
			runLifecycle?.onFinish("web-session-cleanup", async () => {
				await services?.webBrowser?.trimToLatestSession();
			});
			const tools = GraphBase.chat.addTool(input.tools, ...WEB_FEATURE_TOOLS);
			const allSessions =
				(await services?.webBrowser?.getAllSessionsInfo()) ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				`${WEB_FEATURE_SYSTEM_PROMPT}\n\n${formatOpenWebSessions(allSessions)}`,
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
