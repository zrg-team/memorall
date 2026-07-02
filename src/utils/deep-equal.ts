/**
 * Structural deep equality for plain JSON-like data (primitives, arrays and
 * plain objects). Short-circuits on the first difference and never allocates
 * intermediate strings, so it is much cheaper than comparing `JSON.stringify`
 * outputs on hot paths (e.g. recomputing a form's dirty flag on every keystroke).
 *
 * Object comparison is key-order-insensitive; arrays are order-sensitive. This
 * matches how config objects are compared in practice while avoiding the cost of
 * serializing large values (like long prompt strings).
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return a === b;
	if (typeof a !== "object") return false;

	const aIsArray = Array.isArray(a);
	const bIsArray = Array.isArray(b);
	if (aIsArray !== bIsArray) return false;

	if (aIsArray && bIsArray) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!deepEqual(a[i], b[i])) return false;
		}
		return true;
	}

	const ao = a as Record<string, unknown>;
	const bo = b as Record<string, unknown>;
	const aKeys = Object.keys(ao);
	const bKeys = Object.keys(bo);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(bo, key)) return false;
		if (!deepEqual(ao[key], bo[key])) return false;
	}
	return true;
};
