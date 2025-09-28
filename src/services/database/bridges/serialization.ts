/**
 * Type-safe serialization/deserialization for RPC bridge
 * Handles Date objects and other non-JSON-serializable types
 */

// Type marker for serialized dates
interface SerializedDate {
	__type: "Date";
	__value: string;
}

// Type marker for serialized data
interface SerializedValue {
	__type: string;
	__value: unknown;
}

/**
 * Check if a value is a serialized date marker
 */
function isSerializedDate(value: unknown): value is SerializedDate {
	return (
		typeof value === "object" &&
		value !== null &&
		"__type" in value &&
		"__value" in value &&
		(value as SerializedValue).__type === "Date"
	);
}

/**
 * Check if a value is a Date object
 */
function isDate(value: unknown): value is Date {
	return value instanceof Date;
}

/**
 * Recursively serialize data for RPC transport
 * Converts Date objects to serialized markers
 */
export function serializeForRpc(data: unknown): unknown {
	if (data === null || data === undefined) {
		return data;
	}

	if (isDate(data)) {
		return {
			__type: "Date",
			__value: data.toISOString(),
		} as SerializedDate;
	}

	if (Array.isArray(data)) {
		return data.map(serializeForRpc);
	}

	if (typeof data === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			result[key] = serializeForRpc(value);
		}
		return result;
	}

	// Primitive values (string, number, boolean) pass through unchanged
	return data;
}

/**
 * Recursively deserialize data from RPC transport
 * Converts serialized date markers back to Date objects
 */
export function deserializeFromRpc(data: unknown): unknown {
	if (data === null || data === undefined) {
		return data;
	}

	if (isSerializedDate(data)) {
		return new Date(data.__value);
	}

	if (Array.isArray(data)) {
		return data.map(deserializeFromRpc);
	}

	if (typeof data === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			result[key] = deserializeFromRpc(value);
		}
		return result;
	}

	// Primitive values pass through unchanged
	return data;
}

/**
 * Type-safe wrapper for query results
 * Ensures timestamps are properly deserialized
 */
export function deserializeQueryResult<T = unknown>(result: {
	rows: unknown[];
	rowCount?: number;
}): { rows: T[]; rowCount?: number } {
	return {
		rows: result.rows.map((row) => deserializeFromRpc(row)) as T[],
		rowCount: result.rowCount,
	};
}
