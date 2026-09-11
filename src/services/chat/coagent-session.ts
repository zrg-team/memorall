/**
 * Marking where a co-agent session starts and stops in the conversation.
 *
 * The co-agent writes into the same conversation as the chat panel, so a
 * transcript mixes turns taken on a web page with turns typed in the extension
 * and nothing says which was which. These markers are the visual answer, built
 * the way a divider is: a stored system message the renderer draws specially.
 *
 * Unlike a divider they carry no meaning for the run. A divider is a history
 * boundary — the agent stops reading above it — whereas a co-agent session is
 * only a thing the reader can see. The agent reads straight through one, and
 * both markers are dropped before messages are sent to the model, exactly as a
 * divider's own text is.
 */

export const COAGENT_SESSION_START = "coagent-session-start" as const;
export const COAGENT_SESSION_END = "coagent-session-end" as const;

export type CoAgentSessionMarkerType =
	| typeof COAGENT_SESSION_START
	| typeof COAGENT_SESSION_END;

const MARKER_TYPES = new Set<string>([
	COAGENT_SESSION_START,
	COAGENT_SESSION_END,
]);

export const isCoAgentSessionMarker = (type: unknown): boolean =>
	typeof type === "string" && MARKER_TYPES.has(type);

/**
 * Types that exist for the reader and must never reach the model.
 *
 * `separator` was already filtered everywhere messages are prepared for a run;
 * the markers join it so a session boundary cannot be mistaken for content.
 */
export const isNonModelMessageType = (type: unknown): boolean =>
	type === "separator" || isCoAgentSessionMarker(type);

/**
 * Whether a co-agent session is currently open, read off the transcript.
 *
 * Derived rather than stored: the dock lives in a content script that is torn
 * down on every navigation, so any flag it kept would be lost exactly when the
 * user leaves the page — which is the case the end marker exists for.
 */
export const isCoAgentSessionOpen = (
	messages: ReadonlyArray<{ type?: string | null }>,
): boolean => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const type = messages[index]?.type;
		if (type === COAGENT_SESSION_START) return true;
		if (type === COAGENT_SESSION_END) return false;
	}
	return false;
};

/**
 * Whether sending a normal chat message should close an open session first.
 *
 * The user may simply walk away from the page rather than pressing exit, so the
 * next message typed in the extension is what closes the session.
 */
export const shouldCloseCoAgentSession = (
	messages: ReadonlyArray<{ type?: string | null }>,
): boolean => isCoAgentSessionOpen(messages);
