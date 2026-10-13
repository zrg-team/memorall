const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

/**
 * `next`, reusing every part of `previous` that is deep-equal to it.
 *
 * State that arrives whole on each change (a structured-cloned snapshot, a
 * parsed response) is new from top to bottom even where nothing changed, and
 * every component reading any of it renders again. Passed through this, the
 * unchanged parts keep their identity, so selectors and `React.memo` see them
 * as unchanged; `previous` itself comes back when nothing changed at all.
 *
 * Only plain objects and arrays are compared; anything else is taken from
 * `next` unless it is the same value.
 */
export function replaceEqualDeep<T>(previous: unknown, next: T): T {
	if (Object.is(previous, next)) return previous as T;

	if (Array.isArray(previous) && Array.isArray(next)) {
		let equal = previous.length === next.length;
		const merged = next.map((item, index) => {
			const kept = replaceEqualDeep(previous[index], item);
			if (kept !== previous[index]) equal = false;
			return kept;
		});
		return (equal ? previous : merged) as T;
	}

	if (isPlainObject(previous) && isPlainObject(next)) {
		const keys = Object.keys(next);
		let equal = Object.keys(previous).length === keys.length;
		const merged: Record<string, unknown> = {};
		for (const key of keys) {
			const kept = replaceEqualDeep(previous[key], next[key]);
			if (kept !== previous[key] || !(key in previous)) equal = false;
			merged[key] = kept;
		}
		return (equal ? previous : merged) as T;
	}

	return next;
}
