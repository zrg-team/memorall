/**
 * Postgres rejects the NUL character in text and jsonb ("unsupported Unicode
 * escape sequence"), so one in any field fails the whole row's write.
 */
export const stripNulCharacters = (value: string): string =>
	value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;

/**
 * Strips NUL from every string in a JSON value and leaves the rest as it is
 * (unlike sanitizeForJson, which also turns undefined into null).
 */
export const stripNulDeep = <T>(value: T): T => {
	if (typeof value === "string") return stripNulCharacters(value) as T;
	if (Array.isArray(value)) return value.map(stripNulDeep) as T;
	if (value && typeof value === "object" && !(value instanceof Date)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				stripNulCharacters(key),
				stripNulDeep(item),
			]),
		) as T;
	}
	return value;
};

export function sanitizeForJson(value: unknown, seen = new WeakSet()): unknown {
	if (value === undefined || value === null) return null;

	const type = typeof value;
	if (type === "string") return stripNulCharacters(value as string);
	if (type === "number" || type === "boolean") {
		return value;
	}
	if (type === "bigint") return (value as bigint).toString();
	if (type === "function" || type === "symbol") return null;
	if (value instanceof Date) return value.toISOString();

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeForJson(item, seen));
	}

	if (type === "object") {
		if (seen.has(value as object)) return null;
		seen.add(value as object);
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			result[stripNulCharacters(key)] = sanitizeForJson(item, seen);
		}
		return result;
	}

	return null;
}
