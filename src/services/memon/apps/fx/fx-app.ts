import { memonDisplayPath } from "../../constants";
import type { MemonFxState, MemonPiCodeFolder } from "../../types";
import type { OutputRead } from "./output-log";

/**
 * fx on a Memon machine: Vercel's fx coding agent, its terminal running in
 * the machine and shown in the fx window.
 *
 * fx works in a folder and keeps its conversations per folder, so opening its
 * window asks for one, as pi code does (`fx` in the Terminal opens it in the
 * tab's folder). Closing the window, fx's /exit or shutting the computer
 * down stops it; leaving the view does not, so fx keeps working while no
 * view is attached. Views attach with a size, replay fx's output from the
 * start, then follow it by cursor and send raw keys.
 */

/** A started fx terminal, as the machine drives it. */
export interface FxRunner {
	status(): { working: boolean; cwd: string };
	/** Sizes fx to the view; returns the cursor its replay starts at. */
	attach(columns: number, rows: number): number;
	read(cursor: number, waitMs: number): Promise<OutputRead>;
	input(data: string): void;
	resize(columns: number, rows: number): void;
	dispose(): Promise<void>;
}

export interface MemonFxPort {
	start(options: {
		home: string;
		/** Where fx works: its project root. */
		cwd: string;
		/** The agent (flow id) the computer belongs to; its usage is booked there. */
		agentId: string | null;
		sandboxSessionKey: string;
		/** Open the folder's latest conversation instead of a new one. */
		continueLast?: boolean;
		/** fx ended on its own (/exit). */
		onExit: () => void;
		onChange: () => void;
	}): Promise<FxRunner>;
	/** The folders fx kept conversations in, the one used last first. */
	folders(home: string): Promise<MemonPiCodeFolder[]>;
}

export interface FxRead extends OutputRead {
	/** fx is not running (any more): stop reading. */
	closed: boolean;
}

/** Where open() put fx. */
export interface FxOpened {
	cwd: string;
	/** fx already worked there: its window only came up. */
	shown: boolean;
}

interface FxHost {
	sessionKey: string;
	home: () => string;
	agentId: () => string | null;
	changed: () => void;
	/** Close the fx window (fx exited). */
	quit: () => void;
	/** Opens the fx window, or brings it up; true when it was not open. */
	show: () => boolean;
}

export class MemonFx {
	private runner: FxRunner | undefined;
	private starting: Promise<FxRunner | undefined> | undefined;
	/** The folder the fx on its way works in. */
	private startingCwd: string | undefined;
	private error: string | undefined;
	/** The window asks which folder to open fx in. */
	private choosing = false;
	/** Bumped by stop(), so a start still on its way is thrown away. */
	private generation = 0;

	constructor(
		private readonly host: FxHost,
		private readonly port: MemonFxPort | undefined,
	) {}

	get active(): boolean {
		return Boolean(this.runner || this.starting);
	}

	/**
	 * The user opened fx: its window asks which folder to open, unless fx runs
	 * or starts.
	 */
	choose(): void {
		if (this.active) return;
		this.choosing = true;
		this.error = undefined;
		this.host.changed();
	}

	/** The folders fx kept conversations in, the one used last first. */
	async recentFolders(): Promise<MemonPiCodeFolder[]> {
		return (await this.port?.folders(this.host.home())) ?? [];
	}

	/**
	 * The user opens fx in a folder (the folder picker, `fx` in the Terminal),
	 * on its last conversation there with `continueLast`: fx starts there, or
	 * starts again there when it was idle elsewhere. Throws while it works.
	 */
	async open(
		cwd: string,
		options: { continueLast?: boolean } = {},
	): Promise<FxOpened> {
		const current = this.runner?.status().cwd ?? this.startingCwd;
		if (this.active && current === cwd && !options.continueLast) {
			this.host.show();
			return { cwd, shown: true };
		}
		if (this.runner?.status().working) {
			throw new Error(
				`fx is working in ${memonDisplayPath(current ?? cwd, this.host.home())}; wait for it or stop it first.`,
			);
		}
		await this.release();
		this.boot(cwd, options.continueLast);
		this.host.show();
		return { cwd, shown: false };
	}

	private boot(cwd: string, continueLast?: boolean): void {
		if (!this.port) {
			this.error = "fx is not available here.";
			this.host.changed();
			return;
		}
		this.error = undefined;
		this.choosing = false;
		const generation = ++this.generation;
		this.startingCwd = cwd;
		this.starting = this.port
			.start({
				home: this.host.home(),
				cwd,
				agentId: this.host.agentId(),
				sandboxSessionKey: this.host.sessionKey,
				continueLast,
				onExit: () => {
					if (generation === this.generation) this.host.quit();
				},
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

	/** Stops fx: its model request and any command are abandoned. */
	async stop(): Promise<void> {
		await this.release();
		this.host.changed();
	}

	private async release(): Promise<void> {
		this.generation += 1;
		const runner = this.runner;
		this.runner = undefined;
		this.starting = undefined;
		this.startingCwd = undefined;
		this.error = undefined;
		this.choosing = false;
		await runner?.dispose();
	}

	state(): MemonFxState | undefined {
		if (this.runner) {
			const status = this.runner.status();
			return {
				status: "running",
				instance: this.generation,
				working: status.working,
				cwd: status.cwd,
			};
		}
		if (this.starting) {
			return {
				status: "starting",
				instance: this.generation,
				working: false,
				cwd: this.startingCwd,
			};
		}
		if (this.error)
			return { status: "error", working: false, error: this.error };
		if (this.choosing) return { status: "choosing", working: false };
		return undefined;
	}

	private async ready(): Promise<FxRunner | undefined> {
		return this.runner ?? (await this.starting);
	}

	async attach(columns: number, rows: number): Promise<number | null> {
		const runner = await this.ready();
		return runner ? runner.attach(columns, rows) : null;
	}

	async read(cursor: number, waitMs: number): Promise<FxRead> {
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
}
