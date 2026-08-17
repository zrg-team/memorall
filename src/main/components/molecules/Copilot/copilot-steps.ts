/**
 * The guided tour Memorall shows on first run and from Settings → Help & Tour.
 *
 * Kept as a pure builder so the copy, the targets and the ordering can be tested
 * without mounting the provider — and so the tour reads as one document instead
 * of being buried in provider state.
 *
 * Shape of the tour: one opening step, one stop per workspace tab in the order
 * the nav renders them, and one closing step that tells the user how to start.
 * Every stop names what that tab contributes to an answer, so a user who reads
 * nothing else still learns what the workspace is for.
 */

export interface CopilotStep {
	id: string;
	title: string;
	content: string;
	/** CSS selector for the element the spotlight rings. */
	target: string;
	/**
	 * Tried when `target` never renders. Nav steps fall back to the mobile nav,
	 * and the opening/closing steps fall back to the chat panel — the setup screen
	 * they prefer only exists while no model is configured.
	 */
	fallbackTarget?: string;
	placement?: "top" | "bottom" | "left" | "right" | "center";
	action?: "navigate" | "click" | "none";
	/** Route opened when the user leaves this step, for `action: "navigate"`. */
	navigationPath?: string;
	disableBeacon?: boolean;
	showProgress?: boolean;
	/** `data-agent-cursor-point` key the agent cursor parks on for this step. */
	cursorTarget?: string;
	cursorMessage?: string;
	agentMessage?: string;
	layoutMode?: "default" | "workspace-focus" | "setup-focus";
}

export interface CopilotTourOptions {
	/**
	 * A configured model swaps the opening and closing copy: there is no setup
	 * screen left to point at, so the tour opens and closes on chat instead.
	 */
	hasLLMConfigured: boolean;
}

/** Loose on purpose — the builder only ever passes literal keys. */
export type CopilotTranslate = (key: string) => string;

interface WorkspaceStop {
	id: string;
	/** Shared copilot id from `app-navigation`, e.g. `agents` for `/agents`. */
	navId: string;
	path: string;
	translationKey: string;
}

/**
 * One stop per workspace tab, in the order the nav renders them: who is
 * answering → what it knows → what it can do → what it thinks with. Runtime is
 * left out on purpose; it is an execution detail, not something a new user needs
 * before their first message.
 */
const WORKSPACE_STOPS: WorkspaceStop[] = [
	{
		id: "agents-navigate",
		navId: "agents",
		path: "/agents",
		translationKey: "agentsNavigate",
	},
	{
		id: "documents-navigate",
		navId: "documents",
		path: "/files",
		translationKey: "documentsNavigate",
	},
	{
		id: "knowledge-navigate",
		navId: "knowledge",
		path: "/memory",
		translationKey: "knowledgeNavigate",
	},
	{
		id: "connections-navigate",
		navId: "connections",
		path: "/connections",
		translationKey: "connectionsNavigate",
	},
	{
		id: "skills-navigate",
		navId: "skills",
		path: "/skills",
		translationKey: "skillsNavigate",
	},
	{
		id: "models-navigate",
		navId: "models",
		path: "/llm",
		translationKey: "modelsNavigate",
	},
];

/** Number of workspace tabs the tour visits, for the "N stops" line in the copy. */
export const COPILOT_WORKSPACE_STOP_COUNT = WORKSPACE_STOPS.length;

export const buildCopilotSteps = (
	t: CopilotTranslate,
	{ hasLLMConfigured }: CopilotTourOptions,
): CopilotStep[] => {
	const step = (
		id: string,
		key: string,
		rest: Partial<CopilotStep> & Pick<CopilotStep, "target">,
	) =>
		({
			id,
			title: t(`copilot.steps.${key}.title`),
			content: t(`copilot.steps.${key}.content`),
			cursorMessage: t(`copilot.steps.${key}.cursor`),
			agentMessage: t(`copilot.steps.${key}.agent`),
			showProgress: true,
			...rest,
		}) satisfies CopilotStep;

	const openingKey = hasLLMConfigured ? "welcomeReady" : "welcome";
	const closingKey = hasLLMConfigured ? "finishReady" : "startHere";

	return [
		// Leaves the layout alone. This step auto-starts on first run and its copy
		// points at the workspace tabs, so collapsing them would both contradict
		// the text and hide every route behind the tour for anything driving the
		// app — which is exactly how it broke the web and sandbox E2E suites.
		// No cursor either: the subject is the whole screen, and a pointer parked
		// on its top-left corner points at nothing.
		step("welcome", openingKey, {
			target: hasLLMConfigured
				? '[data-copilot~="chat-center"]'
				: '[data-copilot~="no-models-screen"]',
			fallbackTarget: '[data-copilot~="chat-left-panel"]',
			placement: "center",
		}),

		...WORKSPACE_STOPS.map((stop) =>
			step(stop.id, stop.translationKey, {
				target: `[data-copilot~="header-nav-${stop.navId}"]`,
				fallbackTarget: `[data-copilot~="mobile-nav-${stop.navId}"]`,
				placement: "bottom",
				action: "navigate",
				navigationPath: stop.path,
				cursorTarget: `copilot-header-nav-${stop.navId}`,
				layoutMode: "workspace-focus",
			}),
		),

		// The cursor lands on the recommended setup card, which is the one thing a
		// new user has to click next. With a model already configured there is no
		// such card, and nothing worth pointing at.
		step("start-here", closingKey, {
			target: hasLLMConfigured
				? '[data-copilot~="chat-center"]'
				: '[data-copilot~="no-models-screen"]',
			fallbackTarget: '[data-copilot~="chat-left-panel"]',
			placement: "center",
			action: "navigate",
			navigationPath: "/",
			cursorTarget: hasLLMConfigured ? undefined : "copilot-setup-managed",
			layoutMode: "setup-focus",
		}),
	];
};
