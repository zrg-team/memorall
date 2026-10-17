/**
 * How lists of agents are ordered and named on screen. Pure, so the chat
 * toolbar can use it without the services behind agents.
 */

/**
 * Starred agents first, in the order they were starred, then the rest in the
 * order given. Stars of agents that no longer exist are ignored.
 */
export const sortFavoritesFirst = <T extends { id: string }>(
	items: readonly T[],
	favoriteIds: readonly string[],
): T[] => {
	if (!favoriteIds.length) return [...items];
	const byId = new Map(items.map((item) => [item.id, item]));
	const favorites = favoriteIds
		.map((id) => byId.get(id))
		.filter((item): item is T => Boolean(item));
	const starred = new Set(favoriteIds);
	return [...favorites, ...items.filter((item) => !starred.has(item.id))];
};

/** "Content Writer, Deep Web Researcher +3": the first few names, then a count. */
export const agentTeamNames = (names: readonly string[], shown = 2): string =>
	names.length <= shown + 1
		? names.join(", ")
		: `${names.slice(0, shown).join(", ")} +${names.length - shown}`;
