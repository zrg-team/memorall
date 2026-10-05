/**
 * Vendored from @mariozechner/pi-coding-agent 0.73.1 (MIT, see ../../LICENSE).
 * Browser port: only the built-in commands this app implements are listed.
 * pi's /login, /logout, /share, /export, /import, /fork, /clone, /tree,
 * /scoped-models, /settings, /changelog and /reload belong to the CLI (auth
 * files, gists, packages) and are left out. /sessions is this app's own:
 * every folder's saved sessions, numbered for /resume.
 */

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "model", description: "Show the chat model pi is using" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "sessions", description: "List saved sessions, by folder" },
	{ name: "resume", description: "Open a saved session, in its folder" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "new", description: "Start a new session" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "quit", description: "Quit pi code" },
];
