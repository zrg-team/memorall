/**
 * The message of the error a failure started from. Wrappers keep the original
 * on `cause` (a failed database query's own message is just its SQL), so the
 * deepest error with a message is the one that says what went wrong.
 */
export const rootErrorMessage = (error: unknown): string => {
	let message = error instanceof Error ? error.message : String(error);
	const seen = new Set<unknown>([error]);
	let current = error instanceof Error ? error.cause : undefined;
	while (current !== undefined && current !== null && !seen.has(current)) {
		seen.add(current);
		const next = current instanceof Error ? current.message : String(current);
		if (next) message = next;
		current = current instanceof Error ? current.cause : undefined;
	}
	return message;
};
