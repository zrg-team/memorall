import { MEMON_APPROVAL_WAIT_MS, memonDisplayPath } from "../../constants";
import type {
	MemonPiCodeApproval,
	MemonPiCodeEntry,
	MemonPiCodeQueued,
	MemonPiCodeState,
} from "../../types";
import { isAbsolute, join, normalize } from "./platform/path";

/**
 * pi code on a Memon machine: a pi coding agent session per open window.
 *
 * Opening the window starts pi; closing the window, /quit or shutting the
 * computer down stops it (its model stream and any bash command too). The
 * session belongs to the machine, so it keeps working while no view is
 * attached (the Runtime tab left, the side panel collapsed). Views attach
 * with a size, then read the terminal output by cursor and send raw keys.
 *
 * The Memon agent drives pi too (memon_code): it prompts, waits, steers and
 * stops it, and reads its conversation on the screen. A prompt waits until
 * pi's turn ends (it answers or asks, fails, or the user stops it), so the
 * agent answers pi's questions and hears when the user stopped it. Before
 * the agent hands pi work, the user confirms in the pi window, once per
 * agent run.
 */

export type PiCodeTheme = "dark" | "light";

/** pi as the agent reads it. */
export interface PiCodeRunnerView {
	entries: MemonPiCodeEntry[];
	earlier: number;
	/** How pi's last turn ended, read once it is idle. */
	ended?: "done" | "error" | "stopped";
	/** pi's last reply, when it had text. */
	reply?: string;
	thinkingLevel: string;
	contextPercent?: number;
	activity?: string;
	queued: MemonPiCodeQueued[];
}

/** A started pi session, as the machine drives it. */
export interface PiCodeRunner {
	status(): {
		running: boolean;
		cwd: string;
		model?: string;
		sessionName?: string;
	};
	view(): PiCodeRunnerView;
	/** Sizes pi to the view and returns the cursor a full redraw starts at. */
	attach(columns: number, rows: number, theme?: PiCodeTheme): number;
	read(
		cursor: number,
		waitMs: number,
	): Promise<{ data: string; cursor: number; reset: boolean }>;
	input(data: string): void;
	resize(columns: number, rows: number): void;
	/** A prompt, queued as a steer or follow-up while pi works. */
	submit(text: string, queue?: "steer" | "followUp"): Promise<void>;
	interrupt(): Promise<void>;
	newSession(): Promise<void>;
	compact(customInstructions?: string): Promise<void>;
	/** True once pi is idle; false when still working at the timeout. */
	waitForIdle(timeoutMs: number, signal?: AbortSignal): Promise<boolean>;
	dispose(): Promise<void>;
}

export interface MemonPiCodePort {
	start(options: {
		home: string;
		/** Where pi works; the home when left out. */
		cwd?: string;
		/** The agent (flow id) the computer belongs to; its usage is booked there. */
		agentId?: string | null;
		sandboxSessionKey: string;
		/** The user quit pi from inside it. */
		onQuit: () => void;
		/** What the agent reads changed. */
		onChange: () => void;
	}): Promise<PiCodeRunner>;
}

export interface PiCodeRead {
	data: string;
	cursor: number;
	/** The view's cursor was out of date: clear the screen and write `data`. */
	reset: boolean;
	/** pi is not running (any more): stop reading. */
	closed: boolean;
}

interface PiCodeHost {
	sessionKey: string;
	home: () => string;
	/** The agent (flow id) the computer belongs to, if any. */
	agentId: () => string | null;
	changed: () => void;
	/** Close the pi window (the user quit pi). */
	quit: () => void;
	/** pi code is on for this agent. */
	enabled: () => boolean;
	/** Opens the pi window, or brings it up; true when it was not open. */
	show: () => boolean;
	/** The pi window is in front: the agent's screen shows its conversation. */
	inFront: () => boolean;
	/** What the agent's cursor on the computer says it is doing. */
	cursorLabel: (label: string) => void;
	/** The agent run a call belongs to: an approval holds for that run. */
	runId: () => string | null;
}

/** Keys the agent can press in pi, as its terminal sends them. */
export const PI_CODE_KEYS = {
	enter: "\r",
	"alt+enter": "\x1b\r",
	escape: "\x1b",
	tab: "\t",
	"shift+tab": "\x1b[Z",
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	backspace: "\x7f",
	"ctrl+c": "\x03",
	"ctrl+o": "\x0f",
	"ctrl+t": "\x14",
} as const;
export type PiCodeKey = keyof typeof PI_CODE_KEYS;

export const PI_CODE_ACTIONS = [
	"prompt",
	"wait",
	"stop",
	"keys",
	"new",
	"compact",
	"close",
] as const;
export type PiCodeAction = (typeof PI_CODE_ACTIONS)[number];

export interface PiCodeActionInput {
	action: PiCodeAction;
	/** The prompt, the keys to type, or compaction instructions. */
	text?: string;
	/** A key pressed after `text` (keys). */
	key?: PiCodeKey;
	/** While pi works: steer it after its current tools, or follow up once done. */
	queue?: "steer" | "followUp";
	/** Where pi works when this call starts it. */
	cwd?: string;
	waitSeconds?: number;
}

export interface PiCodeActOptions {
	/**
	 * Messages the user sent to the agent's run and it has not read yet: a
	 * wait for pi returns for them, so the agent never misses the user.
	 */
	inbox?: () => number;
}

/** How long a prompt waits for pi's turn to end, unless the call says. */
export const PI_CODE_DEFAULT_WAIT_SECONDS = 600;
export const PI_CODE_MAX_WAIT_SECONDS = 600;
/** How often a wait checks for a message from the user. */
const INBOX_POLL_MS = 500;
const TASK_CHARS = 2_000;

const NEXT_WHILE_WORKING =
	'memon_code { action: "wait" } waits for it again; a prompt steers it; { action: "stop" } stops it.';
const USER_STOPPED =
	"The user stopped pi code. Something it did was likely wrong or unwanted: look at its last steps, and ask the user what to change if that is not clear. Do not hand pi the same work again unchanged.";
const USER_CLOSED =
	"The user closed pi code before it finished; its session is saved in ~/.pi/agent/sessions. Find out why before you go on.";

type Decision = "approve" | "deny" | "timeout" | "cancelled" | "closed";

const NOT_APPROVED: Record<Exclude<Decision, "approve">, string> = {
	deny: 'The user declined pi code for this. Do the coding yourself with the Terminal and Files. Remember it now: memon_memory { action: "add", text: "Code it myself; the user does not want pi code." }, and do not use pi code again unless the user asks for it.',
	timeout:
		"The user did not answer whether to use pi code. Do the coding yourself with the Terminal and Files.",
	cancelled: "The user stopped the run before answering.",
	closed:
		"The user closed pi code instead of answering. Do the coding yourself with the Terminal and Files.",
};

/** What the agent calls the action, while it runs. */
export const piCodeActionLabel = (input: PiCodeActionInput): string => {
	switch (input.action) {
		case "prompt":
			return "Handing work to pi code";
		case "wait":
			return "Waiting for pi code";
		case "stop":
			return "Stopping pi code";
		case "keys":
			return "Typing in pi code";
		case "new":
			return "Starting a new pi session";
		case "compact":
			return "Compacting pi's conversation";
		case "close":
			return "Closing pi code";
	}
};

export class MemonPiCode {
	private runner: PiCodeRunner | undefined;
	private starting: Promise<PiCodeRunner | undefined> | undefined;
	/** The folder the session on its way works in. */
	private startingCwd: string | undefined;
	private error: string | undefined;
	/** Bumped by stop(), so a start still on its way is thrown away. */
	private generation = 0;
	private approval: MemonPiCodeApproval | undefined;
	private approvalSeq = 0;
	private answerWait: ((decision: Decision) => void) | undefined;
	/** The agent run the user let use pi code. */
	private approvedRun: string | null = null;
	/** The agent stopped pi's last turn itself, so the user did not. */
	private agentStopped = false;
	private readonly waits = new Set<AbortController>();

	constructor(
		private readonly host: PiCodeHost,
		private readonly port: MemonPiCodePort | undefined,
	) {}

	get active(): boolean {
		return Boolean(this.runner || this.starting);
	}

	/**
	 * Starts pi unless it is already running or starting. While the agent's
	 * request waits for the user, pi starts only once they allow it.
	 */
	start(cwd?: string): void {
		if (this.runner || this.starting || this.approval) return;
		if (!this.port) {
			this.error = "pi code is not available here.";
			this.host.changed();
			return;
		}
		this.error = undefined;
		const generation = ++this.generation;
		this.startingCwd = cwd ?? this.host.home();
		this.starting = this.port
			.start({
				home: this.host.home(),
				cwd,
				agentId: this.host.agentId(),
				sandboxSessionKey: this.host.sessionKey,
				onQuit: () => this.host.quit(),
				onChange: () => this.host.changed(),
			})
			.then(async (runner) => {
				if (generation !== this.generation) {
					await runner.dispose();
					return undefined;
				}
				this.runner = runner;
				return runner;
			})
			.catch((error: unknown) => {
				if (generation === this.generation) {
					this.error = error instanceof Error ? error.message : String(error);
				}
				return undefined;
			})
			.finally(() => {
				if (generation !== this.generation) return;
				this.starting = undefined;
				this.host.changed();
			});
		this.host.changed();
	}

	/** Stops pi: aborts the model stream and any bash command, closes the session. */
	async stop(): Promise<void> {
		this.generation += 1;
		this.answerWait?.("closed");
		this.approvedRun = null;
		const runner = this.runner;
		this.runner = undefined;
		this.starting = undefined;
		this.startingCwd = undefined;
		this.error = undefined;
		await runner?.dispose();
	}

	state(): MemonPiCodeState | undefined {
		const approval = this.approval ? { ...this.approval } : undefined;
		if (this.runner) {
			const status = this.runner.status();
			const view = this.runner.view();
			return {
				status: "running",
				working: status.running,
				cwd: status.cwd,
				model: status.model,
				thinkingLevel: view.thinkingLevel,
				contextPercent: view.contextPercent,
				sessionName: status.sessionName,
				activity: view.activity,
				transcript: view.entries,
				earlier: view.earlier,
				queued: view.queued,
				approval,
			};
		}
		if (this.starting)
			return {
				status: "starting",
				working: false,
				cwd: this.startingCwd,
				approval,
			};
		if (this.error)
			return { status: "error", working: false, error: this.error, approval };
		if (approval) return { status: "idle", working: false, approval };
		return undefined;
	}

	private async ready(): Promise<PiCodeRunner | undefined> {
		return this.runner ?? (await this.starting);
	}

	async attach(
		columns: number,
		rows: number,
		theme?: PiCodeTheme,
	): Promise<number | null> {
		const runner = await this.ready();
		return runner ? runner.attach(columns, rows, theme) : null;
	}

	async read(cursor: number, waitMs: number): Promise<PiCodeRead> {
		const runner = await this.ready();
		if (!runner) return { data: "", cursor, reset: false, closed: true };
		const output = await runner.read(cursor, waitMs);
		return { ...output, closed: this.runner !== runner };
	}

	async input(data: string): Promise<void> {
		(await this.ready())?.input(data);
	}

	async resize(columns: number, rows: number): Promise<void> {
		(await this.ready())?.resize(columns, rows);
	}

	/** The user stops pi's turn from MemonOS, as Escape in pi does. */
	async interrupt(): Promise<void> {
		const runner = this.runner;
		if (!runner?.status().running) return;
		this.agentStopped = false;
		await runner.interrupt();
	}

	// ── The user's answer to the agent ──────────────────────────────────────

	/** The user's answer in the pi window. */
	answerApproval(id: string, decision: "approve" | "deny"): void {
		if (!this.approval || this.approval.id !== id || !this.answerWait) {
			throw new Error("That request is no longer waiting for an answer.");
		}
		this.answerWait(decision);
	}

	/** Releases the agent's waiting calls, e.g. when the user presses Stop. */
	cancelWaits(): void {
		this.answerWait?.("cancelled");
		for (const wait of this.waits) wait.abort();
	}

	/**
	 * Null once the user lets the agent hand pi this work (or did earlier in
	 * the run); otherwise what the agent should do instead.
	 */
	private async askToUse(task: string): Promise<string | null> {
		const runId = this.host.runId();
		if (runId && this.approvedRun === runId) return null;
		if (this.approval) {
			throw new Error("pi code already waits for the user's answer.");
		}
		this.approvalSeq += 1;
		const id = `p${this.approvalSeq}`;
		const trimmed = task.trim();
		this.approval = {
			id,
			task:
				trimmed.length > TASK_CHARS
					? `${trimmed.slice(0, TASK_CHARS - 1)}…`
					: trimmed,
			requestedAt: Date.now(),
		};
		const opened = this.host.show();
		this.host.cursorLabel("Waiting for your approval");
		this.host.changed();
		const decision = await new Promise<Decision>((resolve) => {
			const timer = setTimeout(() => finish("timeout"), MEMON_APPROVAL_WAIT_MS);
			const finish = (answer: Decision) => {
				clearTimeout(timer);
				this.answerWait = undefined;
				resolve(answer);
			};
			this.answerWait = finish;
		});
		this.approval = undefined;
		if (decision === "approve") {
			this.approvedRun = runId;
			this.host.cursorLabel("Handing work to pi code");
			this.host.changed();
			return null;
		}
		// The window was opened only to ask: it goes with the question.
		if (opened && !this.active && decision !== "closed") this.host.quit();
		this.host.changed();
		return NOT_APPROVED[decision];
	}

	/** Starts pi (in `cwd`) unless it runs, brings it up and waits for it. */
	private async launch(cwd?: string): Promise<PiCodeRunner> {
		if (!this.active) this.start(cwd);
		this.host.show();
		const runner = await this.ready();
		if (!runner) {
			throw new Error(
				this.error
					? `pi code could not start: ${this.error}`
					: "pi code is not running.",
			);
		}
		return runner;
	}

	private running(): PiCodeRunner {
		if (!this.runner) {
			throw new Error(
				this.starting
					? "pi code is still starting; call again in a moment."
					: 'pi code is not running; hand it work with { action: "prompt", text }.',
			);
		}
		return this.runner;
	}

	/**
	 * Waits until pi's turn ends (it answers or asks, fails, the user stops
	 * or closes it), up to the call's wait; a message from the user to the
	 * agent or Stop ends the wait sooner. Says how it went.
	 */
	private async report(
		runner: PiCodeRunner,
		lead: string,
		waitSeconds: number,
		inbox?: () => number,
	): Promise<string> {
		const wait = new AbortController();
		this.waits.add(wait);
		const seconds = Math.min(
			Math.max(waitSeconds, 0),
			PI_CODE_MAX_WAIT_SECONDS,
		);
		let userWrote = false;
		const poll =
			seconds > 0 && inbox
				? setInterval(() => {
						if (inbox() > 0) {
							userWrote = true;
							wait.abort();
						}
					}, INBOX_POLL_MS)
				: undefined;
		if (seconds > 0) {
			this.host.cursorLabel("Waiting for pi code");
			this.host.changed();
		}
		const idle = await runner
			.waitForIdle(seconds * 1000, wait.signal)
			.finally(() => {
				clearInterval(poll);
				this.waits.delete(wait);
			});
		if (this.runner !== runner) return `${lead}${USER_CLOSED}`;
		const view = runner.view();
		if (!idle) {
			const doing = view.activity ? ` (${view.activity})` : "";
			const why = userWrote ? " The user wrote to you: read it first." : "";
			return `${lead}pi code is still working${doing}.${why} ${NEXT_WHILE_WORKING}`;
		}
		switch (view.ended) {
			case undefined:
				return `${lead}pi code is idle.`;
			case "stopped":
				return `${lead}${this.agentStopped ? "pi code is stopped." : USER_STOPPED}`;
			case "error": {
				const last = view.entries.at(-1);
				const error = last?.kind === "error" ? `: ${last.text}` : ".";
				return `${lead}pi code stopped on an error${error}`;
			}
			case "done": {
				const next =
					'If it asks you something, answer it with memon_code { action: "prompt", text }; ask the user only what you cannot decide. Otherwise check its work before you answer.';
				if (!view.reply) {
					return `${lead}pi code's turn is over, without a reply. ${next}`;
				}
				return this.host.inFront()
					? `${lead}pi code's turn is over; its reply is on the screen. ${next}`
					: `${lead}pi code's turn is over. Its reply:\n${view.reply}\n\n${next}`;
			}
		}
	}

	private resolveFolder(path: string): string {
		const home = this.host.home();
		const trimmed = path.trim();
		if (!trimmed || trimmed === "~") return home;
		if (trimmed.startsWith("~/"))
			return normalize(join(home, trimmed.slice(2)));
		return isAbsolute(trimmed)
			? normalize(trimmed)
			: normalize(join(home, trimmed));
	}

	private display(path: string): string {
		return memonDisplayPath(path, this.host.home());
	}

	/** The Memon agent's memon_code call. Returns the summary line. */
	async act(
		input: PiCodeActionInput,
		options: PiCodeActOptions = {},
	): Promise<string> {
		if (!this.host.enabled()) {
			throw new Error(
				"pi code is turned off for this agent (MemonOS Bot settings). Do the coding yourself with the Terminal and Files.",
			);
		}
		switch (input.action) {
			case "prompt": {
				const text = input.text?.trim();
				if (!text) throw new Error("prompt needs text: the work for pi.");
				const cwd =
					input.cwd !== undefined ? this.resolveFolder(input.cwd) : undefined;
				const current = this.runner?.status().cwd ?? this.startingCwd;
				if (cwd && this.active && current && current !== cwd) {
					throw new Error(
						`pi code works in ${this.display(current)}. Close it first ({ action: "close" }) to start it in ${this.display(cwd)}, or name paths in the prompt.`,
					);
				}
				const notApproved = await this.askToUse(text);
				if (notApproved) return notApproved;
				const runner = await this.launch(cwd);
				const working = runner.status().running;
				await runner.submit(text, input.queue);
				this.agentStopped = false;
				const lead = working
					? `Queued for pi code (${input.queue === "followUp" ? "after it finishes" : "after its current tools"}). `
					: "Sent to pi code. ";
				return this.report(
					runner,
					lead,
					input.waitSeconds ?? PI_CODE_DEFAULT_WAIT_SECONDS,
					options.inbox,
				);
			}
			case "keys": {
				if (!input.text && !input.key) {
					throw new Error("keys needs text to type, a key to press, or both.");
				}
				const typed = [input.text ? `"${input.text}"` : null, input.key ?? null]
					.filter(Boolean)
					.join(" then ");
				const notApproved = await this.askToUse(`Type in pi: ${typed}`);
				if (notApproved) return notApproved;
				const runner = await this.launch();
				runner.input(
					`${input.text ?? ""}${input.key ? PI_CODE_KEYS[input.key] : ""}`,
				);
				// Escape or Ctrl+C from the agent interrupts pi like its stop.
				this.agentStopped = input.key === "escape" || input.key === "ctrl+c";
				return this.report(
					runner,
					`Typed ${typed}. `,
					input.waitSeconds ?? 1,
					options.inbox,
				);
			}
			case "wait": {
				const runner = await this.ready();
				if (!runner) {
					throw new Error(
						this.error
							? `pi code could not start: ${this.error}`
							: 'pi code is not running; hand it work with { action: "prompt", text }.',
					);
				}
				return this.report(
					runner,
					"",
					input.waitSeconds ?? PI_CODE_DEFAULT_WAIT_SECONDS,
					options.inbox,
				);
			}
			case "stop": {
				const runner = this.running();
				if (!runner.status().running) return "pi code was not working.";
				this.agentStopped = true;
				await runner.interrupt();
				return "Stopped pi code; its queued messages were dropped.";
			}
			case "new": {
				const runner = this.running();
				await runner.newSession();
				return "Started a new pi session; the last one is saved in ~/.pi/agent/sessions.";
			}
			case "compact": {
				const runner = this.running();
				await runner.compact(input.text?.trim() || undefined);
				return this.report(runner, "Compacted pi's conversation. ", 0);
			}
			case "close": {
				if (!this.active && !this.error) return "pi code was not open.";
				this.host.quit();
				return "Closed pi code; its session is saved in ~/.pi/agent/sessions.";
			}
		}
	}
}
