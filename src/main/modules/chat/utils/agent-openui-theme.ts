import { serviceManager } from "@/services";
import { logInfo } from "@/utils/logger";

/**
 * The OpenUI theme an agent is configured for.
 *
 * The model is told to pass the theme as the fourth argument to the root
 * `CardBlock`, and the renderer reads it back out of what the model wrote. When
 * the model forgets, the agent's theme was silently lost and the block rendered
 * as shadcn. Recording the configured theme on the message gives the renderer
 * something to fall back on that is actually the agent's setting.
 */
const VISUALIZE_RESPONSE_STEP = "visualize-response";

const themeCache = new Map<string, string | undefined>();

export const getAgentOpenUITheme = async (
	flowId: string | undefined,
): Promise<string | undefined> => {
	if (!flowId || flowId === "chat") return undefined;
	if (themeCache.has(flowId)) return themeCache.get(flowId);

	let theme: string | undefined;
	try {
		const config = await serviceManager.flowBuilderService.getUnifiedFlowConfig(
			{ flowId },
		);
		const step = config.steps.find(
			(entry) => entry.name === VISUALIZE_RESPONSE_STEP && entry.enabled,
		);
		const candidate = (step?.config as { theme?: unknown } | undefined)?.theme;
		theme = typeof candidate === "string" && candidate ? candidate : undefined;
	} catch (error) {
		// A missing theme is not worth failing a send over; the renderer keeps its
		// own default.
		logInfo(`Could not read the OpenUI theme for flow ${flowId}:`, error);
	}

	themeCache.set(flowId, theme);
	return theme;
};

/** Agent settings can change mid-session; drop the memo when they do. */
export const clearAgentOpenUIThemeCache = (flowId?: string): void => {
	if (flowId) themeCache.delete(flowId);
	else themeCache.clear();
};
