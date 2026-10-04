import type { ActiveWebSessionInfo } from "../../../interfaces/services/web-browser.js";

/**
 * The web sessions the model may reuse, as a reminder past the cached
 * prefix. Sessions open, close and move between messages (the run's end
 * trims them; they close after 10 idle minutes), so a list written into the
 * system prompt rewrote the start of every next request and nothing of the
 * conversation behind it was reused. Every feature that lists sessions uses
 * this one format, so two of them in one agent attach the same block once.
 *
 * No timestamps: a `lastAccessedAt` would change on every tool call.
 */
export const formatOpenWebSessions = (
	sessions: readonly ActiveWebSessionInfo[],
): string | null => {
	const open = sessions.filter((session) => session.isOpen);
	if (open.length === 0) return null;
	const entries = open.map(
		(session, index) => `Session ${index + 1}:
  - sessionId: ${session.sessionId}
  - requestedUrl: ${session.requestedUrl}
  - currentUrl: ${session.currentUrl}
  - title: ${session.title || "(no title)"}
  - mode: ${session.mode || "iframe"}`,
	);
	return `## OPEN WEB SESSIONS\n${entries.join("\n\n")}`;
};
