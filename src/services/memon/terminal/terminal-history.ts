/**
 * The Terminal's command history, ~/.terminal_history: one command per line,
 * oldest first, as a shell keeps ~/.bash_history. An older history file
 * (JSON, { "history": ["ls", "node app.js"] }) reads the same.
 */

/** Commands kept; the oldest go first. */
export const MEMON_TERMINAL_HISTORY_MAX = 200;

const fromJson = (content: string): string[] | null => {
	const trimmed = content.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
	let data: unknown;
	try {
		data = JSON.parse(trimmed);
	} catch {
		return null;
	}
	const history =
		typeof data === "object" && data !== null && !Array.isArray(data)
			? (data as { history?: unknown }).history
			: data;
	return Array.isArray(history)
		? history.filter((entry): entry is string => typeof entry === "string")
		: null;
};

/** Reads a history file; an empty one is no history. */
export const parseTerminalHistory = (content: string): string[] =>
	(fromJson(content) ?? content.split(/\r?\n/))
		.map((entry) => entry.trim())
		.filter(Boolean)
		.slice(-MEMON_TERMINAL_HISTORY_MAX);

export const serializeTerminalHistory = (history: readonly string[]): string =>
	history.length
		? `${history.map((entry) => entry.replace(/\r?\n/g, " ")).join("\n")}\n`
		: "";

/**
 * A `.terminal` file: a command to run in a new Terminal tab, where it says.
 *
 * { "command": "npm run dev", "cwd": "~/landing-page" }
 */
export interface MemonTerminalLauncher {
	command: string;
	/** Where it runs: `~` is the home; the home by default. */
	cwd?: string;
}

/** Reads a launcher; null when the file is not one (an older history). */
export const parseTerminalLauncher = (
	content: string,
): MemonTerminalLauncher | null => {
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch {
		// A plain file is the command itself, like a shell script's one line.
		const command = content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
			.join(" && ");
		return command ? { command } : null;
	}
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return null;
	}
	const { command, cwd } = data as { command?: unknown; cwd?: unknown };
	if (typeof command !== "string" || !command.trim()) return null;
	return {
		command: command.trim(),
		...(typeof cwd === "string" && cwd.trim() ? { cwd: cwd.trim() } : {}),
	};
};

export const serializeTerminalLauncher = (
	launcher: MemonTerminalLauncher,
): string =>
	`${JSON.stringify(
		{
			command: launcher.command,
			...(launcher.cwd ? { cwd: launcher.cwd } : {}),
		},
		null,
		2,
	)}\n`;
