import type { AgentScreenContent } from "./AgentIconCanvas";
import type { AgentIconScreenMetadata } from "@/services/database/entities/flows";

/**
 * What an agent shows on its screen.
 *
 * Emoji need more of the panel than text does, hence the two scales — the same
 * ratios the agent form's picker previews with, which is why this lives here
 * rather than being written out twice.
 *
 * `fallbackName` matters wherever several agents appear together. The icon draws
 * the same robot for every agent, so agents with no screen configured are
 * indistinguishable; deriving an initial from the name keeps them apart. The
 * agent form deliberately omits it, because there the blank screen is the truth
 * being edited.
 */
export const toAgentScreenContent = (
	iconScreen: AgentIconScreenMetadata | null | undefined,
	fallbackName?: string,
): AgentScreenContent | undefined => {
	if (iconScreen) {
		return {
			kind: iconScreen.kind,
			value: iconScreen.value,
			color: iconScreen.color,
			scale: iconScreen.kind === "emoji" ? 0.72 : 0.52,
		};
	}

	const initial = fallbackName?.trim().charAt(0).toUpperCase();
	if (!initial) return undefined;

	return { kind: "text", value: initial, scale: 0.52 };
};
