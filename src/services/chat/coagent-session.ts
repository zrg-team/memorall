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
): boolean => findOpenCoAgentSession(messages) !== null;

interface MarkerLike {
	type?: string | null;
	metadata?: unknown;
}

/**
 * The start marker of the session still open, if there is one.
 *
 * Returned rather than a bare boolean because a session is only meaningful
 * for the page it was opened on. Nothing reliably writes an end marker when
 * the user closes the tab, so a session opened once would otherwise stay open
 * for ever and every later visit would go unmarked.
 */
export const findOpenCoAgentSession = <T extends MarkerLike>(
	messages: ReadonlyArray<T>,
): T | null => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.type === COAGENT_SESSION_START) return message;
		if (message?.type === COAGENT_SESSION_END) return null;
	}
	return null;
};

/** The page a start marker was written for, when it recorded one. */
export const getCoAgentSessionUrl = (marker: MarkerLike): string | null => {
	const metadata = marker.metadata;
	if (typeof metadata !== "object" || metadata === null) return null;
	const url = (metadata as { url?: unknown }).url;
	return typeof url === "string" && url ? url : null;
};

/**
 * How long an open session may sit idle before the next question starts a new one.
 *
 * Closing the tab writes no end marker, so without a limit a session opened
 * once would stay open for ever and swallow every later visit. Time is the
 * right measure rather than the page: a session deliberately spans navigation,
 * because following a trail across pages is what the co-agent is for.
 */
export const CO_AGENT_SESSION_MAX_IDLE_MS = 30 * 60 * 1000;

const toTimestamp = (value: unknown): number | null => {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "string" || typeof value === "number") {
		const parsed = new Date(value).getTime();
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

/**
 * Whether the open session has gone cold and the next question should open a
 * fresh one.
 *
 * Measured from the newest message in the transcript: a session with nothing
 * after its start marker is as old as the marker itself.
 */
export const isCoAgentSessionStale = (
	messages: ReadonlyArray<{ createdAt?: unknown }>,
	now: number,
	maxIdleMs: number = CO_AGENT_SESSION_MAX_IDLE_MS,
): boolean => {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const at = toTimestamp(messages[index]?.createdAt);
		if (at !== null) return now - at > maxIdleMs;
	}
	// Nothing datable to judge by; leaving the session open is the safer read.
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
