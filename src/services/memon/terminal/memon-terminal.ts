import { runsAlongside } from "@/services/sandbox-container/alongside-commands";
import { resolvePath } from "@/services/sandbox-container/host-commands/command-line";
import type { MemonEmbeddedPort } from "../embedded-browser";
import type { MemonAvailability, MemonFilesPort } from "../memon-machine";
import type {
	MemonTerminalApproval,
	MemonTerminalLine,
	MemonTerminalState,
} from "../types";
import {
	CommandApprovals,
	type CommandApprovalsHost,
} from "./command-approvals";
import {
	completeTerminalLine,
	completeTerminalPath,
	completionWord,
	expandHome,
	type MemonTerminalCompletion,
	splitCompletionPath,
} from "./terminal-commands";
import { MEMON_TERMINAL_HISTORY_MAX } from "./terminal-history";

export interface MemonCommandOutcome {
	processId?: string;
	running: boolean;
	exitCode: number | null;
	output: MemonTerminalLine[];
	cursor?: string;
	/** Ran next to the command still running (a curl while a server runs). */
	alongside?: boolean;
}

export interface MemonTerminalPort {
	availability(): Promise<MemonAvailability>;
	run(
		command: string,
		options: { cwd: string; waitMs: number; sessionKey: string },
	): Promise<MemonCommandOutcome>;
	/** New output of a running command; waits up to waitMs for some. */
	read(
		processId: string,
		cursor: string | undefined,
		sessionKey: string,
		waitMs?: number,
	): Promise<MemonCommandOutcome>;
	/** Types a line into a running command. */
	input(processId: string, text: string, sessionKey: string): Promise<void>;
	/** Stops a running command (Ctrl+C). */
	stop(processId: string, sessionKey: string): Promise<void>;
}

export interface MemonTerminalPorts {
	terminal: MemonTerminalPort;
	files: Pick<MemonFilesPort, "isDirectory" | "list">;
	embedded?: Pick<MemonEmbeddedPort, "servers" | "stopServer">;
}

/** What the Terminal needs from the computer it runs in. */
export interface MemonTerminalHost extends CommandApprovalsHost {
	/** The sandbox session commands run in. */
	readonly sessionKey: string;
	/** Throws when the Terminal app is turned off. */
	requireApp(): void;
	/** The agent's home: where tabs start, `cd` goes and `~` points. */
	home(): string;
	/** The command history changed, to be kept in its file. */
	historyChanged(): void;
}

/** The command that keeps running, and the tab it prints into. */
export interface MemonRunningCommand {
	command: string;
	tabId: string;
	elapsedMs: number;
	quietMs: number;
}

/** What a line the user entered in the running command's tab did. */
export type MemonTerminalLineOutcome = "ran" | "typed";

interface TerminalTab {
	id: string;
	cwd: string;
	lines: MemonTerminalLine[];
	lastExitCode: number | null;
	/** Lines of its screen dropped from the front of `lines`. */
	dropped: number;
	/** Its screen, new after each clear. */
	screen: number;
	/** The commands it ran, oldest first: the latest few. */
	recent: string[];
}

/** Screens are numbered from the time, so a restarted Terminal's are new. */
let screenSeq = Date.now();
const nextScreen = (): number => {
	screenSeq += 1;
	return screenSeq;
};

const newTab = (id: string, cwd: string): TerminalTab => ({
	id,
	cwd,
	lines: [],
	lastExitCode: null,
	dropped: 0,
	screen: nextScreen(),
	recent: [],
});

interface RunningCommand {
	command: string;
	tabId: string;
	startedAt: number;
	lastOutputAt: number;
	processId: string | null;
	cursor: string | undefined;
	/** Servers that already ran when it started: a stop closes the rest. */
	serversBefore: ReadonlySet<number>;
}

const MAX_LINES = 400;
const MAX_TABS = 6;
/** Commands each tab lists as its own (the history keeps them all). */
const TAB_RECENT_COMMANDS = 5;
/** The running tab's last lines, shown while another tab is in front. */
const RUNNING_TAB_TAIL_LINES = 8;
/** How long a new command may take before its first output is shown. */
const COMMAND_START_WAIT_MS = 400;
/** Each output read waits this long for something new. */
const COMMAND_READ_WAIT_MS = 1_000;
/** How long a stopped command has to end before the Terminal lets it go. */
const STOP_GRACE_MS = 3_000;
/** A stopped command's exit code, as a shell reports Ctrl+C. */
const STOPPED_EXIT_CODE = 130;
/** Longest a command run next to a running one may take. */
const ALONGSIDE_WAIT_MS = 60_000;
/** How often a running command is checked for servers it started. */
const SERVER_CHECK_MS = 3_000;
/** A local address a command prints, or "listening on (port) 3000". */
const PORT_MENTION =
	/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b|\blistening on (?:port )?:?(\d{2,5})\b/gi;
/** Only a lone `cd`: `cd dir && node app.js` runs in the sandbox shell. */
const BARE_CD = /^cd(?:\s+([^;&|]+?))?\s*$/;
/** `clear`, `history` and `history -c`: the Terminal's own, run in the tab. */
const BUILTIN = /^(clear|history)(?:\s+(-c))?\s*$/;
/** `make && cd dist`: once it succeeds, the tab moves to dist. */
const TRAILING_CD = /&&\s*cd\s+([^;&|]+)$/;

/**
 * The computer's Terminal: tabs, each with its own working directory and
 * output, and the one command that keeps running. almostnode streams one
 * command's output and stdin at a time, so next to it, in any tab, run only
 * lines that never start node (ls, curl).
 */
export class MemonTerminal {
	private tabs: TerminalTab[];
	private activeId = "1";
	/** Commands run in any tab, by the user or the agent, oldest first. */
	private commandHistory: string[] = [];
	private tabSeq = 1;
	private runningCommand: RunningCommand | null = null;
	/** Servers the sandbox lists. */
	private listedServers: number[] = [];
	/** Ports the running command printed (http://localhost:3000). */
	private mentionedPorts = new Set<number>();
	private lastServerCheck = 0;
	private readingOutput = false;
	private readonly settledWaiters = new Set<() => void>();
	private availabilityState: MemonAvailability = { available: true };
	private disposed = false;
	private readonly approvals: CommandApprovals;

	constructor(
		private readonly host: MemonTerminalHost,
		private readonly ports: MemonTerminalPorts,
	) {
		this.approvals = new CommandApprovals(host);
		this.tabs = [newTab("1", host.home())];
	}

	// ── Home and history ───────────────────────────────────────────────────

	/**
	 * The home moved (`follow`: the agent was renamed, its folder with it) or
	 * is another agent's: tabs in the old home go to the new one.
	 */
	changeHome(previous: string, home: string, follow: boolean): void {
		for (const tab of this.tabs) {
			if (tab.cwd === previous || tab.cwd.startsWith(`${previous}/`)) {
				tab.cwd = follow ? `${home}${tab.cwd.slice(previous.length)}` : home;
			}
		}
		this.host.changed();
	}

	/** The command history, oldest first. */
	get history(): readonly string[] {
		return this.commandHistory;
	}

	/** The history as its file has it. */
	setHistory(history: readonly string[]): void {
		this.commandHistory = history.slice(-MEMON_TERMINAL_HISTORY_MAX);
		this.host.changed();
	}

	clearHistory(): void {
		this.commandHistory = [];
		this.host.historyChanged();
		this.host.changed();
	}

	private remember(command: string): void {
		if (!command || this.commandHistory.at(-1) === command) return;
		this.commandHistory = [...this.commandHistory, command].slice(
			-MEMON_TERMINAL_HISTORY_MAX,
		);
		this.host.historyChanged();
	}

	/** A directory as `cd` takes it: nothing or `~` is the home. */
	private resolveDir(cwd: string, path: string | undefined): string {
		const value = path?.trim().replace(/^(['"])(.*)\1$/, "$2");
		if (!value || value === "~") return this.host.home();
		if (value.startsWith("~/")) {
			return resolvePath(this.host.home(), value.slice(2));
		}
		return resolvePath(cwd, value);
	}

	// ── Availability and lifecycle ─────────────────────────────────────────

	get availability(): MemonAvailability {
		return this.availabilityState;
	}

	async refreshAvailability(): Promise<void> {
		try {
			this.availabilityState = await this.ports.terminal.availability();
		} catch (error) {
			this.availabilityState = {
				available: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/** Releases the agent's call waiting for an approval. */
	cancelWaits(): void {
		this.approvals.cancel();
	}

	dispose(): void {
		this.disposed = true;
		this.approvals.cancel();
	}

	// ── Tabs ────────────────────────────────────────────────────────────────

	get activeTabId(): string {
		return this.tab().id;
	}

	/** A tab: the given one, else the one in front. */
	private tab(id?: string | null): TerminalTab {
		const tab = this.tabs.find(
			(candidate) => candidate.id === (id ?? this.activeId),
		);
		if (tab) return tab;
		if (id) throw new Error(`The Terminal has no tab ${id}.`);
		return this.tabs[0] as TerminalTab;
	}

	/** The tab the running command prints into. */
	private runningTab(): TerminalTab {
		const id = this.runningCommand?.tabId;
		return this.tabs.find((tab) => tab.id === id) ?? this.tab();
	}

	private append(tab: TerminalTab, lines: MemonTerminalLine[]): void {
		tab.lines.push(...lines);
		if (tab.lines.length > MAX_LINES) {
			tab.dropped += tab.lines.length - MAX_LINES;
			tab.lines = tab.lines.slice(-MAX_LINES);
		}
	}

	/** A tab's screen starts over, empty. */
	private resetScreen(tab: TerminalTab): void {
		tab.lines = [];
		tab.dropped = 0;
		tab.screen = nextScreen();
	}

	/**
	 * Opens a tab, in front, in `cwd` (default: the current tab's directory);
	 * returns its id.
	 */
	openTab(cwd?: string): string {
		this.host.requireApp();
		if (this.tabs.length >= MAX_TABS) {
			throw new Error(`The Terminal has ${MAX_TABS} tabs; close one first.`);
		}
		this.tabSeq += 1;
		const id = String(this.tabSeq);
		this.tabs.push(newTab(id, cwd ?? this.tab().cwd));
		this.activeId = id;
		this.host.showWindow();
		this.host.changed();
		return id;
	}

	selectTab(id: string): void {
		this.activeId = this.tab(id).id;
		this.host.changed();
	}

	/**
	 * Closes a tab (the one in front by default), stopping the command
	 * running in it. The last tab stays: closing it only clears it.
	 */
	async closeTab(id?: string): Promise<string> {
		const tab = this.tab(id);
		if (this.runningCommand?.tabId === tab.id) await this.stopCommand();
		if (this.tabs.length === 1) {
			this.resetScreen(tab);
			tab.lastExitCode = null;
		} else {
			const index = this.tabs.indexOf(tab);
			this.tabs.splice(index, 1);
			if (this.activeId === tab.id) {
				const next = this.tabs[Math.min(index, this.tabs.length - 1)];
				this.activeId = (next as TerminalTab).id;
			}
		}
		this.host.changed();
		return tab.id;
	}

	// ── Commands ────────────────────────────────────────────────────────────

	get running(): MemonRunningCommand | null {
		const running = this.runningCommand;
		if (!running) return null;
		const now = Date.now();
		return {
			command: running.command,
			tabId: running.tabId,
			elapsedMs: now - running.startedAt,
			quietMs: now - running.lastOutputAt,
		};
	}

	/**
	 * Runs a shell command in a tab (the one in front by default) and streams
	 * its output into it. Each sandbox run is its own process, so each tab
	 * keeps its working directory: a bare `cd dir` only moves it, and a
	 * trailing `&& cd dir` moves it after the command succeeds. Returns after
	 * `waitMs` at most; a longer command keeps running and streaming.
	 */
	async runCommand(
		command: string,
		options: {
			cwd?: string;
			waitMs?: number;
			byUser?: boolean;
			terminalId?: string;
		} = {},
	): Promise<MemonCommandOutcome> {
		this.host.requireApp();
		const trimmed = command.trim();
		const tab = this.tab(options.terminalId);
		const bareCd = BARE_CD.exec(trimmed);
		const builtin = BUILTIN.exec(trimmed);
		const alongside = this.runningCommand !== null;
		if (alongside && !bareCd && !builtin && !runsAlongside(trimmed)) {
			throw this.busyError(tab);
		}
		if (!options.byUser) await this.approvals.require(trimmed, tab.id);
		this.activeId = tab.id;
		this.host.showWindow();
		if (options.cwd) tab.cwd = this.resolveDir(tab.cwd, options.cwd);
		const cwd = tab.cwd;
		this.remember(trimmed);
		if (builtin?.[1] === "clear") return this.clearScreen(tab);
		tab.recent = [...tab.recent, trimmed].slice(-TAB_RECENT_COMMANDS);
		this.append(tab, [{ kind: "command", text: trimmed, cwd }]);
		if (builtin) return this.showHistory(tab, builtin[2] === "-c");
		if (bareCd) return this.changeDirectory(tab, bareCd[1]?.trim());
		// What runs has `~` expanded; the tab shows the line as it was typed.
		const line = expandHome(trimmed, this.host.home());
		if (alongside) return this.runAlongside(tab, trimmed, line, cwd);
		return this.startCommand(tab, trimmed, line, cwd, options.waitMs ?? 10_000);
	}

	/**
	 * Runs a launcher's command (a `.terminal` file) in a tab of its own, in
	 * `cwd` (`~` is the home; the home by default): the tab in front when
	 * nothing ran in it yet, else a new one. Returns the tab.
	 */
	async launch(
		command: string,
		options: { cwd?: string; byUser?: boolean; waitMs?: number } = {},
	): Promise<{ tabId: string; outcome: MemonCommandOutcome }> {
		this.host.requireApp();
		const trimmed = command.trim();
		if (!trimmed) throw new Error("There is no command to run.");
		// Refused before a tab opens, so a refused launch leaves nothing behind.
		if (this.runningCommand && !runsAlongside(trimmed)) {
			throw this.busyError();
		}
		const cwd = this.resolveDir(this.host.home(), options.cwd);
		if (!(await this.ports.files.isDirectory(cwd).catch(() => false))) {
			throw new Error(`${options.cwd ?? cwd} is not a folder.`);
		}
		const front = this.tab();
		const fresh =
			!front.recent.length &&
			!front.lines.length &&
			this.runningCommand?.tabId !== front.id;
		const tabId = fresh ? front.id : this.openTab(cwd);
		this.tab(tabId).cwd = cwd;
		const outcome = await this.runCommand(trimmed, {
			byUser: options.byUser,
			terminalId: tabId,
			waitMs: options.waitMs ?? 0,
		});
		return { tabId, outcome };
	}

	private clearScreen(tab: TerminalTab): MemonCommandOutcome {
		this.resetScreen(tab);
		tab.lastExitCode = 0;
		this.host.changed();
		return { running: false, exitCode: 0, output: [] };
	}

	/** Ctrl+L: clears a tab's screen (the one in front by default). */
	clearTab(id?: string): void {
		this.resetScreen(this.tab(id));
		this.host.changed();
	}

	/**
	 * Tab on a line (the text before the cursor): a command name from the
	 * commands the Terminal knows and the ones run before, any other word
	 * from the files and folders it names, as a shell completes them.
	 */
	async complete(line: string, id?: string): Promise<MemonTerminalCompletion> {
		const tab = this.tab(id);
		const word = completionWord(line);
		if (word.command) return completeTerminalLine(line, this.commandHistory);
		const { dir } = splitCompletionPath(word.value);
		const entries = await this.ports.files
			.list(dir ? this.resolveDir(tab.cwd, dir) : tab.cwd)
			.catch(() => []);
		const completion = completeTerminalPath(line, word, entries);
		if (completion.line !== line || completion.suggestions.length) {
			return completion;
		}
		// Nothing on disk by that name: lines run before that start with it.
		return completeTerminalLine(line, this.commandHistory);
	}

	/** `history` lists the commands, numbered; `history -c` forgets them. */
	private showHistory(tab: TerminalTab, clear: boolean): MemonCommandOutcome {
		if (clear) {
			this.clearHistory();
		} else {
			const width = String(this.commandHistory.length).length;
			this.append(
				tab,
				this.commandHistory.map((entry, index) => ({
					kind: "stdout" as const,
					text: `${String(index + 1).padStart(width + 2)}  ${entry}`,
				})),
			);
		}
		tab.lastExitCode = 0;
		this.host.changed();
		return { running: false, exitCode: 0, output: [] };
	}

	private busyError(tab?: TerminalTab): Error {
		const running = this.runningCommand as RunningCommand;
		const where =
			running.tabId === tab?.id
				? `in this Terminal tab (tab ${running.tabId})`
				: `in Terminal tab ${running.tabId}`;
		// Its server may be what the next command was meant to start.
		const serving = this.servers.length
			? `, serving ${this.servers.map((port) => `http://localhost:${port}`).join(", ")}`
			: "";
		return new Error(
			`\`${running.command}\` is still running ${where}${serving}, and only one such command runs at a time. Next to it you can run file and text commands (ls, cat, mkdir, grep…), curl, git, py, ffmpeg or magick; for anything else, wait for it, type into it, or stop it first.`,
		);
	}

	private async changeDirectory(
		tab: TerminalTab,
		path: string | undefined,
	): Promise<MemonCommandOutcome> {
		const target = this.resolveDir(tab.cwd, path);
		if (await this.ports.files.isDirectory(target).catch(() => false)) {
			tab.cwd = target;
			tab.lastExitCode = 0;
		} else {
			this.append(tab, [
				{ kind: "stderr", text: `cd: ${path}: No such file or directory` },
			]);
			tab.lastExitCode = 1;
		}
		this.host.changed();
		return { running: false, exitCode: tab.lastExitCode, output: [] };
	}

	private followTrailingCd(tab: TerminalTab, command: string, cwd: string) {
		const trailingCd = TRAILING_CD.exec(command);
		if (trailingCd && tab.lastExitCode === 0) {
			tab.cwd = this.resolveDir(cwd, trailingCd[1]);
		}
	}

	/**
	 * Starts the command that keeps running, and waits up to `waitMs`.
	 * `command` is the line as typed; `line` is what runs.
	 */
	private async startCommand(
		tab: TerminalTab,
		command: string,
		line: string,
		cwd: string,
		waitMs: number,
	): Promise<MemonCommandOutcome> {
		const serversBefore = new Set(
			this.ports.embedded
				? await this.ports.embedded.servers().catch(() => this.listedServers)
				: [],
		);
		const startedAt = Date.now();
		this.runningCommand = {
			command,
			tabId: tab.id,
			startedAt,
			lastOutputAt: startedAt,
			processId: null,
			cursor: undefined,
			serversBefore,
		};
		this.host.changed();
		let outcome: MemonCommandOutcome;
		try {
			outcome = await this.ports.terminal.run(line, {
				cwd,
				waitMs: COMMAND_START_WAIT_MS,
				sessionKey: this.host.sessionKey,
			});
		} catch (error) {
			this.settle(null);
			throw error;
		}
		this.append(tab, outcome.output);
		if (outcome.running) this.notePorts(outcome.output);
		if (outcome.running && outcome.processId && this.runningCommand) {
			this.runningCommand.processId = outcome.processId;
			this.runningCommand.cursor = outcome.cursor;
			this.host.changed();
			void this.readOutput();
			await this.waitForCommand(waitMs - (Date.now() - startedAt));
		} else {
			this.settle(outcome.exitCode);
		}
		const running = this.runningCommand !== null;
		if (!running) this.followTrailingCd(tab, command, cwd);
		this.host.changed();
		return {
			processId: outcome.processId,
			running,
			exitCode: running ? null : tab.lastExitCode,
			output: [],
		};
	}

	/**
	 * A line that never starts node (curl, ls), while a command runs: it runs
	 * next to it and must finish. The running command keeps its tab's input.
	 */
	private async runAlongside(
		tab: TerminalTab,
		command: string,
		line: string,
		cwd: string,
	): Promise<MemonCommandOutcome> {
		this.host.changed();
		const outcome = await this.ports.terminal.run(line, {
			cwd,
			waitMs: ALONGSIDE_WAIT_MS,
			sessionKey: this.host.sessionKey,
		});
		this.append(tab, outcome.output);
		if (outcome.running && outcome.processId) {
			// Only one command may keep running; this one had its time.
			await this.ports.terminal
				.stop(outcome.processId, this.host.sessionKey)
				.catch(() => undefined);
			this.append(tab, [
				{
					kind: "system",
					text: `Stopped after ${ALONGSIDE_WAIT_MS / 1000}s: a command next to a running one must finish.`,
				},
			]);
		}
		tab.lastExitCode = outcome.running ? 124 : outcome.exitCode;
		this.followTrailingCd(tab, command, cwd);
		this.host.changed();
		return {
			running: false,
			exitCode: tab.lastExitCode,
			output: [],
			alongside: true,
		};
	}

	/**
	 * Streams the running command's output into its tab until it ends. One
	 * reader at a time; each read waits briefly for new output.
	 */
	private async readOutput(): Promise<void> {
		if (this.readingOutput) return;
		this.readingOutput = true;
		try {
			while (this.runningCommand?.processId && !this.disposed) {
				const running = this.runningCommand;
				const processId = running.processId as string;
				let outcome: MemonCommandOutcome;
				try {
					outcome = await this.ports.terminal.read(
						processId,
						running.cursor,
						this.host.sessionKey,
						COMMAND_READ_WAIT_MS,
					);
				} catch (error) {
					this.append(this.runningTab(), [
						{
							kind: "system",
							text: `Lost the command's output: ${error instanceof Error ? error.message : String(error)}`,
						},
					]);
					this.settle(null);
					return;
				}
				if (this.runningCommand?.processId !== processId) return;
				this.append(this.runningTab(), outcome.output);
				if (outcome.output.length) running.lastOutputAt = Date.now();
				running.cursor = outcome.cursor ?? running.cursor;
				if (!outcome.running) {
					this.settle(outcome.exitCode);
					continue;
				}
				this.notePorts(outcome.output);
				if (outcome.output.length) this.host.changed();
				// A command that keeps running may be a server; say so.
				if (Date.now() - this.lastServerCheck >= SERVER_CHECK_MS) {
					void this.checkServers();
				}
			}
		} finally {
			this.readingOutput = false;
		}
	}

	private settle(exitCode: number | null): void {
		this.mentionedPorts.clear();
		if (this.listedServers.length) void this.checkServers();
		this.runningTab().lastExitCode = exitCode;
		this.runningCommand = null;
		this.host.changed();
		for (const settled of this.settledWaiters) settled();
		this.settledWaiters.clear();
	}

	/** Waits up to `ms` for the running command to end; true once it has. */
	waitForCommand(ms: number): Promise<boolean> {
		if (!this.runningCommand) return Promise.resolve(true);
		if (ms <= 0) return Promise.resolve(false);
		return new Promise((resolve) => {
			const settled = () => {
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				this.settledWaiters.delete(settled);
				resolve(false);
			}, ms);
			this.settledWaiters.add(settled);
		});
	}

	/** Input and Ctrl+C go to the running command: refuse another tab. */
	private requireRunningIn(tabId: string | undefined): RunningCommand {
		const running = this.runningCommand;
		if (!running) {
			throw new Error("No command is running in the Terminal to type into.");
		}
		if (tabId && tabId !== running.tabId) {
			throw new Error(
				`Nothing runs in Terminal tab ${tabId}; \`${running.command}\` runs in tab ${running.tabId}.`,
			);
		}
		return running;
	}

	/** Types a line into the running command, e.g. an answer to a prompt. */
	async sendInput(text: string, tabId?: string): Promise<void> {
		const { processId } = this.requireRunningIn(tabId);
		if (!processId) {
			throw new Error("No command is running in the Terminal to type into.");
		}
		this.append(this.runningTab(), [{ kind: "input", text }]);
		this.host.changed();
		await this.ports.terminal.input(processId, text, this.host.sessionKey);
	}

	/**
	 * A line the user enters in the running command's tab: a line that may
	 * run next to it (ls, curl) runs, and any other line is typed into it.
	 */
	async enterLine(text: string): Promise<MemonTerminalLineOutcome> {
		const running = this.runningCommand;
		if (running && runsAlongside(text.trim())) {
			await this.runCommand(text, {
				byUser: true,
				waitMs: 0,
				terminalId: running.tabId,
			});
			return "ran";
		}
		await this.sendInput(text);
		return "typed";
	}

	/**
	 * Stops the running command (Ctrl+C). A command the sandbox no longer has,
	 * or one that does not end after the stop, is let go: the Terminal must
	 * never stay stuck on a command that is not there.
	 */
	async stopCommand(tabId?: string): Promise<void> {
		if (!this.runningCommand) return;
		const running = this.requireRunningIn(tabId);
		const tab = this.runningTab();
		this.append(tab, [{ kind: "system", text: "^C" }]);
		this.host.changed();
		try {
			if (running.processId) {
				await this.ports.terminal.stop(running.processId, this.host.sessionKey);
				void this.readOutput();
				if (
					!(await this.waitForCommand(STOP_GRACE_MS)) &&
					this.runningCommand === running
				) {
					this.append(tab, [
						{
							kind: "system",
							text: "The command did not end after the stop; the Terminal let it go.",
						},
					]);
				}
			}
		} catch {
			// The sandbox has no such process any more: nothing is running.
		}
		if (this.runningCommand === running) this.settle(STOPPED_EXIT_CODE);
		await this.closeServersOpenedBy(running, tab);
	}

	/** The user's answer to a command waiting for approval. */
	async answerApproval(
		id: string,
		decision: "approve" | "deny",
	): Promise<void> {
		const approved = this.approvals.answer(id, decision);
		if (!approved) return;
		await this.runCommand(approved.command, {
			byUser: true,
			waitMs: 0,
			terminalId: this.tabs.some((tab) => tab.id === approved.terminalId)
				? approved.terminalId
				: undefined,
		});
	}

	get approval(): MemonTerminalApproval | null {
		return this.approvals.current;
	}

	/** Makes sure a running command's output keeps streaming. */
	refresh(): void {
		if (this.runningCommand?.processId) void this.readOutput();
	}

	// ── Servers ─────────────────────────────────────────────────────────────

	/**
	 * Servers in the computer: the ones the sandbox lists, and the ports the
	 * running command says it serves (a server that prints its address is
	 * one, even where the sandbox cannot list it).
	 */
	get servers(): number[] {
		return [...new Set([...this.listedServers, ...this.mentionedPorts])].sort(
			(a, b) => a - b,
		);
	}

	/** Reads which servers run in the sandbox, for the Terminal and Browser. */
	async checkServers(): Promise<number[]> {
		if (!this.ports.embedded) return this.servers;
		this.lastServerCheck = Date.now();
		const listed = await this.ports.embedded.servers();
		if (listed.join() !== this.listedServers.join()) {
			this.listedServers = listed;
			this.host.changed();
		}
		return this.servers;
	}

	/** Records ports a running command prints, like http://localhost:3000. */
	private notePorts(lines: readonly MemonTerminalLine[]): void {
		let added = false;
		for (const line of lines) {
			for (const match of line.text.matchAll(PORT_MENTION)) {
				const port = Number(match[1] ?? match[2]);
				if (port > 0 && port < 65_536 && !this.mentionedPorts.has(port)) {
					this.mentionedPorts.add(port);
					added = true;
				}
			}
		}
		if (added) this.host.changed();
	}

	/**
	 * Closes the servers a stopped command opened: in the sandbox, ending a
	 * process does not close them, and Ctrl+C on a server must stop it.
	 */
	private async closeServersOpenedBy(
		running: RunningCommand,
		tab: TerminalTab,
	): Promise<void> {
		const embedded = this.ports.embedded;
		if (!embedded?.stopServer) return;
		const listed = await embedded.servers().catch(() => [] as number[]);
		const opened = listed.filter((port) => !running.serversBefore.has(port));
		for (const port of opened) {
			await embedded.stopServer(port).catch(() => undefined);
		}
		if (opened.length) {
			this.append(tab, [
				{
					kind: "system",
					text: `Closed ${opened.map((port) => `localhost:${port}`).join(", ")}.`,
				},
			]);
			await this.checkServers().catch(() => undefined);
		}
	}

	// ── Snapshot ────────────────────────────────────────────────────────────

	snapshot(): MemonTerminalState {
		const front = this.tab();
		const running = this.runningCommand;
		return {
			cwd: front.cwd,
			lines: [...front.lines],
			lineOffset: front.dropped,
			screenId: front.screen,
			runningProcessId: running?.processId ?? null,
			runningCommand: running?.command ?? null,
			startedAt: running?.startedAt ?? null,
			lastOutputAt: running?.lastOutputAt ?? null,
			lastExitCode: front.lastExitCode,
			approval: this.approvals.current,
			servers: this.servers,
			tabs: this.tabs.map((tab) => ({
				id: tab.id,
				cwd: tab.cwd,
				running: tab.id === running?.tabId,
				command:
					tab.id === running?.tabId ? running.command : tab.recent.at(-1),
				lastExitCode: tab.id === running?.tabId ? null : tab.lastExitCode,
				recent: [...tab.recent],
			})),
			activeTabId: front.id,
			runningTabId: running?.tabId ?? null,
			runningTabTail:
				running && running.tabId !== front.id
					? this.runningTab().lines.slice(-RUNNING_TAB_TAIL_LINES)
					: undefined,
			history: [...this.commandHistory],
		};
	}
}
