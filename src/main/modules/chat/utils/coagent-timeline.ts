/**
 * Reading a co-agent session's route back out of the transcript.
 *
 * A session follows the user across pages: they ask about a listing, move to
 * the one next door, ask again. Read later in the chat panel that arrives as an
 * undifferentiated run of turns, with nothing to say where each was asked.
 *
 * Nothing extra is stored for this. Every co-agent message already records the
 * page it was asked on, so the route is derived at render time — which means it
 * works on transcripts written before any of this existed.
 */

export interface CoAgentPage {
	url: string;
	title: string | null;
}

interface MessageLike {
	id: string;
	metadata?: unknown;
}

const readString = (
	source: Record<string, unknown>,
	key: string,
): string | null => {
	const value = source[key];
	return typeof value === "string" && value.trim() ? value : null;
};

/** The page a co-agent message was asked on, if it was a co-agent message. */
export const getCoAgentPage = (message: MessageLike): CoAgentPage | null => {
	const metadata = message.metadata;
	if (typeof metadata !== "object" || metadata === null) return null;
	const record = metadata as Record<string, unknown>;
	if (record.source !== "co-agent") return null;

	const url = readString(record, "pageUrl");
	if (!url) return null;

	return { url, title: readString(record, "pageTitle") };
};

/** Whether this message came from the co-agent at all. */
export const isCoAgentMessage = (message: MessageLike): boolean => {
	const metadata = message.metadata;
	if (typeof metadata !== "object" || metadata === null) return false;
	return (metadata as Record<string, unknown>).source === "co-agent";
};

/**
 * A short name for a page: the host, which is what someone recognises.
 *
 * Full URLs on a listing site are long and near-identical, so they make a poor
 * label; the title is kept alongside for the tooltip.
 */
export const formatCoAgentPageLabel = (page: CoAgentPage): string => {
	try {
		const { host, pathname } = new URL(page.url);
		if (!host) return page.title ?? page.url;
		// Enough path to tell two pages on one site apart, but not a wall of it.
		const trimmed = pathname.replace(/\/+$/, "");
		if (!trimmed || trimmed === "") return host;
		const last = trimmed.split("/").filter(Boolean).at(-1) ?? "";
		return last.length > 0 && last.length <= 28 ? `${host}/${last}` : host;
	} catch {
		return page.title ?? page.url;
	}
};

/**
 * The messages that begin a new page within a run of co-agent turns.
 *
 * The first co-agent message after any other kind counts as a change, so a run
 * always announces where it started — including in transcripts that never got
 * a session marker written.
 */
export const findCoAgentPageChanges = <T extends MessageLike>(
	messages: ReadonlyArray<T>,
): Map<string, CoAgentPage> => {
	const changes = new Map<string, CoAgentPage>();
	let currentUrl: string | null = null;

	for (const message of messages) {
		const page = getCoAgentPage(message);
		if (!page) {
			// A turn typed in the panel ends the run, so the next co-agent turn
			// says where it is again rather than silently continuing.
			if (!isCoAgentMessage(message)) currentUrl = null;
			continue;
		}
		if (page.url !== currentUrl) {
			changes.set(message.id, page);
			currentUrl = page.url;
		}
	}

	return changes;
};
