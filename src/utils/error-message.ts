/** Read errors that cross native IPC or a worker as plain objects. */
export const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	if (error !== null && typeof error === "object") {
		if ("message" in error && typeof error.message === "string")
			return error.message;
		try {
			return JSON.stringify(error) ?? "Unknown error";
		} catch {
			return "Unknown error";
		}
	}
	return String(error);
};

/**
 * The message of the error a failure started from. Wrappers keep the original
 * on `cause` (a failed database query's own message is just its SQL), so the
 * deepest error with a message is the one that says what went wrong.
 */
export const rootErrorMessage = (error: unknown): string => {
	let message = errorMessage(error);
	const seen = new Set<unknown>([error]);
	let current = error instanceof Error ? error.cause : undefined;
	while (current !== undefined && current !== null && !seen.has(current)) {
		seen.add(current);
		const next = errorMessage(current);
		if (next) message = next;
		current = current instanceof Error ? current.cause : undefined;
	}
	return message;
};
