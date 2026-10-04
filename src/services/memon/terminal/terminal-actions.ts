import type { MemonTerminal } from "./memon-terminal";

/**
 * One agent action on the Terminal: run a command, wait for, type into or
 * stop the running one, or open, switch or close a tab.
 */
export interface MemonTerminalAction {
	command?: string;
	/** A line typed into the running command. */
	input?: string;
	stop?: boolean;
	cwd?: string;
	/** A tab id, or "new" to open one. */
	terminal?: string;
	/** Closes `terminal`'s tab (default: the one in front). */
	closeTab?: boolean;
	waitSeconds?: number;
}

export type MemonTerminalActionKind =
	| "close"
	| "run"
	| "stop"
	| "input"
	| "switch"
	| "wait";

/** What an action does: the first thing its fields ask for. */
export const terminalActionKind = (
	action: MemonTerminalAction,
): MemonTerminalActionKind => {
	if (action.closeTab) return "close";
	if (action.command) return "run";
	if (action.stop) return "stop";
	if (action.input !== undefined) return "input";
	if (action.terminal && !action.waitSeconds) return "switch";
	return "wait";
};

const shorten = (text: string, max = 40): string =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The agent's cursor label for an action. */
export const terminalActionLabel = (action: MemonTerminalAction): string => {
	switch (terminalActionKind(action)) {
		case "close":
			return "Closing a Terminal tab";
		case "run":
			return `Running ${shorten(action.command ?? "")}`;
		case "stop":
			return "Stopping the command";
		case "input":
			return "Typing into the command";
		case "switch":
			return "Switching Terminal tab";
		case "wait":
			return "Waiting for the command";
	}
};

/** Quiet this long, a running command may just be finished. */
const QUIET_HINT_MS = 5_000;
const DEFAULT_WAIT_SECONDS = 10;

const formatDuration = (ms: number): string => {
	const seconds = Math.round(ms / 1000);
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** Where the running command stands, for the agent; "" when none runs. */
const runningStatus = (terminal: MemonTerminal): string => {
	const running = terminal.running;
	if (!running) return "";
	const { servers } = terminal;
	// The sandbox cannot tell a finished script from a waiting one: a script
	// that never calls process.exit keeps "running". A server is meant to.
	const hint = servers.length
		? ` It serves ${servers.map((port) => `http://localhost:${port}`).join(", ")}; leave it running and open that address in the Browser to see the page.`
		: running.quietMs >= QUIET_HINT_MS
			? ` It has printed nothing for ${formatDuration(running.quietMs)}; if its work is done, stop it.`
			: "";
	return `\`${running.command}\` is still running (${formatDuration(running.elapsedMs)}); its output streams into Terminal tab ${running.tabId}.${hint} Call memon_run with no command to keep waiting, input to answer a prompt, or stop: true to stop it.`;
};

/** A finished action's summary, or where the still-running command stands. */
const doneOrRunning = (terminal: MemonTerminal, done: string): string =>
	runningStatus(terminal) || done;

/** A summary that always holds, with where the running command stands. */
const withRunning = (terminal: MemonTerminal, summary: string): string =>
	[summary, runningStatus(terminal)].filter(Boolean).join(" ");

/** The tab an action works in, brought to the front: "new" opens one. */
const frontTab = (
	terminal: MemonTerminal,
	tab: string | undefined,
): string | undefined => {
	if (tab === "new") return terminal.openTab();
	if (tab) terminal.selectTab(tab);
	return tab;
};

/** Carries out an agent action on the Terminal; returns its summary. */
export const runTerminalAction = async (
	terminal: MemonTerminal,
	action: MemonTerminalAction,
): Promise<string> => {
	const waitSeconds = action.waitSeconds ?? DEFAULT_WAIT_SECONDS;
	const kind = terminalActionKind(action);
	if (kind === "close") {
		const closed = await terminal.closeTab(
			action.terminal === "new" ? undefined : action.terminal,
		);
		return withRunning(
			terminal,
			`Closed Terminal tab ${closed}; tab ${terminal.activeTabId} is in front.`,
		);
	}
	const tab = frontTab(terminal, action.terminal);
	switch (kind) {
		case "run": {
			const command = action.command ?? "";
			const outcome = await terminal.runCommand(command, {
				cwd: action.cwd,
				waitMs: waitSeconds * 1000,
				terminalId: tab,
			});
			const ran = `Ran \`${command}\` in Terminal tab ${terminal.activeTabId} (exit ${outcome.exitCode ?? "?"})`;
			const running = terminal.running;
			if (outcome.alongside && running) {
				return `${ran} next to \`${running.command}\` (Terminal tab ${running.tabId}), which keeps running.`;
			}
			return doneOrRunning(terminal, `${ran}.`);
		}
		case "stop":
			await terminal.stopCommand(tab);
			return doneOrRunning(terminal, "Stopped the command.");
		case "input":
			await terminal.sendInput(action.input ?? "", tab);
			await terminal.waitForCommand(waitSeconds * 1000);
			return doneOrRunning(
				terminal,
				`Typed "${action.input}"; the command finished.`,
			);
		case "switch":
			return withRunning(terminal, `Terminal tab ${tab} is in front.`);
		case "wait":
			if (!terminal.running) {
				if (!action.waitSeconds) {
					return "Nothing is running in the Terminal; pass command to run one.";
				}
				await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
				return `Waited ${waitSeconds}s; nothing is running in the Terminal.`;
			}
			await terminal.waitForCommand(waitSeconds * 1000);
			return doneOrRunning(terminal, "The command finished.");
	}
};
