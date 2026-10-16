/**
 * One fx terminal running on a Memon machine.
 *
 * libfx runs the fx CLI's terminal compiled to WebAssembly. Here it has no
 * screen of its own: what it prints goes to an output log the fx window
 * replays and follows, and the keys the window sends go back in. Its model
 * requests go to Memorall's models (fx-gateway), its shell to the Memon
 * sandbox and its settings, prompt history and conversations to ~/.fx.
 */

import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { logWarn } from "@/utils/logger";
import type { MemonSkillsPort } from "../../memon-machine";
import {
	createFxGatewayFetch,
	FX_CHAT_MODEL,
	FX_GATEWAY_PLACEHOLDER_KEY,
	type FxGatewayModels,
} from "./fx-gateway";
import {
	type FxSkillEntry,
	fxInstructions,
	installFxSkills,
} from "./fx-skills";
import {
	createFxConfigStore,
	createFxPromptHistoryStore,
	createFxSessionStore,
} from "./fx-stores";
import { createFxWorkspace } from "./fx-workspace";
import { type OutputRead, OutputLog } from "./output-log";

/** How long fx's first read of its instructions waits for the skills. */
const SKILLS_WAIT_MS = 6_000;
/** fx's status (Program Status Protocol): `OSC 7501;state=<state>`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches an escape sequence
const STATUS_PATTERN = /\x1b\]7501;state=([a-z_]+)/g;
export const FX_UNSUPPORTED =
	"fx needs WebAssembly JSPI, which this browser does not have. Use a current Chrome, Edge or Safari.";

export interface FxSessionOptions {
	home: string;
	/** Where fx works: its project root. */
	cwd: string;
	agentId: string | null;
	sandboxSessionKey: string;
	fs: IFlowFileSystem;
	getSandbox: () => Promise<IAgentSandboxService>;
	models: () => Promise<FxGatewayModels>;
	skills?: Pick<MemonSkillsPort, "list" | "read">;
	/** Where fx-term.wasm is served. */
	wasmUrl: string;
	/** Open the latest conversation instead of a new one. */
	continueLast?: boolean;
	/** fx's session a model request belongs to. */
	onSession?: (sessionId: string) => void;
	/** fx ended (/exit, Ctrl+D, or it failed). */
	onExit: (code: number) => void;
	/** Its status changed. */
	onChange: () => void;
}

export class FxSession {
	private readonly log = new OutputLog();
	private columns = 100;
	private rows = 30;
	private working = false;
	private disposed = false;
	private runtime:
		| {
				write(data: string): void;
				resize(): void;
				abort(): void;
				exited: Promise<number>;
		  }
		| undefined;

	private constructor(private readonly options: FxSessionOptions) {}

	static async start(options: FxSessionOptions): Promise<FxSession> {
		const session = new FxSession(options);
		await session.boot();
		return session;
	}

	private async boot(): Promise<void> {
		const { createFxTerminal, supportsJspi } = await import("libfx/wasm");
		if (!supportsJspi()) throw new Error(FX_UNSUPPORTED);
		const options = this.options;
		// fx runs every command in its folder; a new agent's home is not there
		// until something is written to it.
		await options.fs.mkdir(options.cwd, { recursive: true });

		// The skills are written while fx starts; its first read of the
		// instructions waits for them, but not past fx's own read timeout.
		const skills: Promise<FxSkillEntry[]> = options.skills
			? installFxSkills(
					options.fs,
					options.home,
					options.skills,
					options.agentId,
				).catch(() => [])
			: Promise.resolve([]);
		const instructions = async () =>
			fxInstructions(
				await Promise.race([
					skills,
					new Promise<FxSkillEntry[]>((resolve) =>
						setTimeout(() => resolve([]), SKILLS_WAIT_MS),
					),
				]),
			);

		const self = this;
		const runtime = await createFxTerminal({
			wasm: options.wasmUrl,
			terminal: {
				get cols() {
					return self.columns;
				},
				get rows() {
					return self.rows;
				},
				write: (bytes: Uint8Array) => this.output(bytes),
				// Input reaches fx through runtime.write and sizes through
				// runtime.resize, so there is nothing to subscribe to.
				onData: () => () => {},
				onResize: () => () => {},
			},
			env: {
				AI_GATEWAY_API_KEY: FX_GATEWAY_PLACEHOLDER_KEY,
				FX_SKIP_ONBOARDING: "1",
				FX_AUTO_UPGRADE: "0",
				FX_NO_OPEN_BROWSER: "1",
				FX_DISABLE_KEYCHAIN: "1",
				// fx follows the chat's model unless the user picks one (/model).
				FX_MODEL: FX_CHAT_MODEL,
			},
			args: options.continueLast ? ["--resume", "last"] : [],
			fetch: createFxGatewayFetch({
				models: options.models,
				onSession: options.onSession,
			}),
			workspace: createFxWorkspace({
				fs: options.fs,
				getSandbox: options.getSandbox,
				sessionKey: options.sandboxSessionKey,
				home: options.home,
				root: options.cwd,
				instructions,
			}),
			configStore: createFxConfigStore(options.fs, options.home),
			promptHistoryStore: createFxPromptHistoryStore(
				options.fs,
				options.home,
				options.cwd,
			),
			sessionStore: createFxSessionStore(options.fs, options.home, options.cwd),
			// The machine has no clipboard or browser of its own: fx prints
			// links, and the window copies what the user selects.
			clipboard: null,
			openUrl: () => false,
			// fx says only that saving its history or a session failed; why
			// comes as an event.
			onEvent: (event) => {
				if (event.type.endsWith("_error")) logWarn(`fx ${event.type}`, event);
			},
		});
		this.runtime = runtime;
		runtime.exited.then((code) => {
			this.working = false;
			this.log.release();
			if (!this.disposed) options.onExit(code);
		});
		await runtime.interactive;
		this.log.markPreamble();
	}

	private output(bytes: Uint8Array): void {
		const text = this.log.write(bytes);
		let state: string | undefined;
		for (const match of text.matchAll(STATUS_PATTERN)) state = match[1];
		if (state === undefined) return;
		const working = state === "working";
		if (working === this.working) return;
		this.working = working;
		this.options.onChange();
	}

	status(): { working: boolean; cwd: string } {
		return { working: this.working, cwd: this.options.cwd };
	}

	/** Sizes fx to the view; returns the cursor its replay starts at. */
	attach(columns: number, rows: number): number {
		this.resize(columns, rows);
		return this.log.origin;
	}

	read(cursor: number, waitMs: number): Promise<OutputRead> {
		return this.log.read(cursor, waitMs);
	}

	input(data: string): void {
		this.runtime?.write(data);
	}

	resize(columns: number, rows: number): void {
		const cols = Math.max(20, Math.floor(columns));
		const height = Math.max(5, Math.floor(rows));
		if (cols === this.columns && height === this.rows) return;
		this.columns = cols;
		this.rows = height;
		this.runtime?.resize();
	}

	/** Stops fx: its model request and any command are abandoned. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.runtime?.abort();
		this.log.release();
	}
}
