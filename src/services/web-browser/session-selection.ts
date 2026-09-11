/**
 * Choosing which open tab should fetch a resource.
 *
 * Kept apart from the web session registry so it can be tested on its own: the
 * registry reaches the platform layer and the whole service tree on import.
 */

export interface TabSessionCandidate {
	id: string;
	tabId?: number;
	mode: string;
	currentUrl: string;
	lastAccessedAt: number;
}

const usableTabs = <T extends TabSessionCandidate>(
	sessions: Iterable<T>,
): T[] =>
	Array.from(sessions).filter(
		(session) => typeof session.tabId === "number" && session.mode !== "iframe",
	);

const mostRecent = <T extends TabSessionCandidate>(
	sessions: T[],
): T | undefined =>
	sessions.reduce<T | undefined>(
		(best, session) =>
			!best || session.lastAccessedAt > best.lastAccessedAt ? session : best,
		undefined,
	);

const originOf = (url: string): string | null => {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
};

/** The most recently used tab, whatever it happens to be showing. */
export const pickLatestTabSession = <T extends TabSessionCandidate>(
	sessions: Iterable<T>,
): T | undefined => mostRecent(usableTabs(sessions));

/**
 * The tab best placed to fetch `url`: one already on that origin.
 *
 * Fetching from inside a tab is only worth doing because the request carries
 * that site's cookies and its own Referer. The most recently used tab is a poor
 * proxy for that — asking a Google search tab for a batdongsan image sends
 * Google's cookies and trips the hotlink check that using a tab was supposed to
 * satisfy. Match the origin first; fall back to the latest tab only when nothing
 * is on that site, since it is still likelier to work than no tab at all.
 */
export const pickTabSessionForUrl = <T extends TabSessionCandidate>(
	sessions: Iterable<T>,
	url: string,
): T | undefined => {
	const candidates = usableTabs(sessions);
	const targetOrigin = originOf(url);
	if (!targetOrigin) return mostRecent(candidates);

	const sameOrigin = candidates.filter(
		(session) => originOf(session.currentUrl) === targetOrigin,
	);
	return mostRecent(sameOrigin) ?? mostRecent(candidates);
};
