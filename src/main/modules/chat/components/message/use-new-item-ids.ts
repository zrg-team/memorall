import { useEffect, useRef } from "react";

const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * Which rows of a live list showed up after the list first rendered.
 *
 * Rows present on the first render are history — a message replayed from the
 * store, or a panel the user just re-opened — and should simply be there. Only
 * rows that arrive later happened in front of the user, so only those are worth
 * animating in.
 *
 * A row is reported as new for the single render it appears on: rows record
 * themselves as seen in an effect, once they have mounted and captured their
 * own entry state.
 */
export function useNewItemIds(ids: string[]): ReadonlySet<string> {
	const seen = useRef<Set<string> | null>(null);
	const isFirstRender = seen.current === null;
	if (seen.current === null) seen.current = new Set(ids);
	const seenIds = seen.current;

	const newIds = isFirstRender
		? EMPTY
		: new Set(ids.filter((id) => !seenIds.has(id)));

	useEffect(() => {
		for (const id of ids) seenIds.add(id);
	});

	return newIds;
}
