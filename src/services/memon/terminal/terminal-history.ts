/**
 * A `.terminal` file: the Terminal's command history, as JSON, oldest first.
 * The Terminal keeps ~/my.terminal current as commands run.
 *
 * { "history": ["ls", "node app.js"] }
 */

/** Commands kept; the oldest go first. */
export const MEMON_TERMINAL_HISTORY_MAX = 200;

/** Reads a `.terminal` file; an empty one is no history. Throws on anything else. */
export const parseTerminalHistory = (content: string): string[] => {
	if (!content.trim()) return [];
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`it is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	const history =
		typeof data === "object" && data !== null && !Array.isArray(data)
			? (data as { history?: unknown }).history
			: data;
	if (!Array.isArray(history)) {
		throw new Error('it must be a JSON object with a "history" list');
	}
	return history
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.slice(-MEMON_TERMINAL_HISTORY_MAX);
};

export const serializeTerminalHistory = (history: readonly string[]): string =>
	`${JSON.stringify({ history }, null, 2)}\n`;
