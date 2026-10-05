/**
 * One running pi inside a Memon machine.
 *
 * Builds pi the way its CLI does (settings, keybindings, AGENTS.md and
 * skills, a persisted session, the read/bash/edit/write/grep/find/ls tools,
 * the interactive TUI), but on the agent's Memon home: files through the
 * Memon file system, bash in the Memon sandbox, and the chat's model. The
 * TUI draws on a StreamTerminal that xterm.js views attach to.
 */
import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { ReasoningEffort } from "@/types/openai";
import type { MemonPiCodeQueued } from "../../../types";
import { Agent, type ThinkingLevel } from "../agent";
import type { Model } from "../ai";
import { AgentSession } from "../coding-agent/core/agent-session";
import { DEFAULT_THINKING_LEVEL } from "../coding-agent/core/defaults";
import { FooterDataProvider } from "../coding-agent/core/footer-data-provider";
import { KeybindingsManager } from "../coding-agent/core/keybindings";
import { convertToLlm } from "../coding-agent/core/messages";
import {
	getDefaultSessionDir,
	SessionManager,
} from "../coding-agent/core/session-manager";
import {
	PreloadedSettingsStorage,
	SettingsManager,
} from "../coding-agent/core/settings-manager";
import { createBashToolDefinition } from "../coding-agent/core/tools/bash";
import { createEditToolDefinition } from "../coding-agent/core/tools/edit";
import { createFindToolDefinition } from "../coding-agent/core/tools/find";
import { createGrepToolDefinition } from "../coding-agent/core/tools/grep";
import { createLsToolDefinition } from "../coding-agent/core/tools/ls";
import { createReadToolDefinition } from "../coding-agent/core/tools/read";
import { createWriteToolDefinition } from "../coding-agent/core/tools/write";
import { InteractiveMode } from "../coding-agent/modes/interactive/interactive-mode";
import { initTheme } from "../coding-agent/modes/interactive/theme/theme";
import { join } from "../platform/path";
import {
	type ChatModelLink,
	connectChatModel,
	thinkingLevelForEffort,
} from "./chat-model";
import { createPiFileSystem } from "./file-system";
import { loadSessionResources, PI_CONFIG_DIR } from "./resources";
import { createSandboxBashOperations } from "./sandbox-bash";
import { StreamTerminal, type TerminalRead } from "./stream-terminal";
import { buildTranscript, type Transcript } from "./transcript";

/** The pi release this port follows. */
export const PI_VERSION = "0.73.1";

export type PiCodeTheme = "dark" | "light";

export interface PiCodeSessionOptions {
	/** The agent's Memon home; "~" and pi's ~/.pi/agent live here. */
	home: string;
	/** Where pi starts (defaults to home). */
	cwd?: string;
	/** Sandbox session the bash tool runs in. */
	sandboxSessionKey: string;
	theme: PiCodeTheme;
	columns?: number;
	rows?: number;
	fs: IFlowFileSystem;
	getSandbox: () => Promise<IAgentSandboxService>;
	getLlm: () => Promise<ILLMService>;
	/** The chat composer's reasoning effort for a model, if one is set. */
	getReasoningEffort?: (
		provider: string,
		modelId: string,
	) => Promise<ReasoningEffort | undefined>;
	/** A saved session to open (pi's /resume) instead of a new one. */
	sessionFile?: string;
	/** The user quit pi (/quit, Ctrl+C twice, Ctrl+D). */
	onQuit: () => void;
	/** /resume picked a saved session: start pi again on it. */
	onResume?: (sessionFile: string) => void;
	/** What the agent reads changed: running/idle, a message, a tool, the model. */
	onChange: () => void;
}

export interface PiCodeStatus {
	/** The agent is working: a model turn, a tool, a ! command, compaction or a retry. */
	running: boolean;
	cwd: string;
	/** provider/model the next turn uses, when one is selected. */
	model?: string;
	sessionName?: string;
}

/** pi as the Memon agent reads it on the screen. */
export interface PiCodeView extends Transcript {
	thinkingLevel: string;
	contextPercent?: number;
	/** What pi does right now, while it works. */
	activity?: string;
	queued: MemonPiCodeQueued[];
}

/** Session events after which the agent's view of pi is out of date. */
const VIEW_EVENTS = new Set<string>([
	"agent_start",
	"agent_end",
	"message_start",
	"message_end",
	"tool_execution_start",
	"tool_execution_end",
	"queue_update",
	"compaction_start",
	"compaction_end",
	"auto_retry_start",
	"auto_retry_end",
	"session_info_changed",
	"thinking_level_changed",
	"model_changed",
]);
/** How often a wait checks on pi, and how long pi must stay idle to count. */
const IDLE_POLL_MS = 250;
const IDLE_SETTLE_MS = 400;

const ENVIRONMENT_NOTE = [
	"Environment: you are running inside MemonOS, a computer that lives in the user's browser.",
	"- The file system is the agent's Memon files. Paths start at / and the home directory (~) is the current agent's folder.",
	"- bash runs in a browser sandbox (almostnode): a POSIX-like shell with Node.js, npm/npx and common tools (ls, cat, grep, find, sed, awk, jq, ...), plus git, python/pip and curl run by the host. It is not a full Linux: no sudo, apt or system packages. Commands run side by side, but only one serves at a time: a second server is stopped.",
	"- Long-running servers started from bash keep the sandbox busy; prefer short commands.",
].join("\n");

export class PiCodeSession {
	readonly terminal: StreamTerminal;
	/** pi's folder was not there: pi made it, empty, when it started. */
	createdCwd = false;
	private disposed = false;
	private unsubscribers: Array<() => void> = [];
	private viewCache: { key: readonly unknown[]; view: PiCodeView } | undefined;

	private constructor(
		private readonly session: AgentSession,
		private readonly mode: InteractiveMode,
		terminal: StreamTerminal,
		private readonly footerData: FooterDataProvider,
		private readonly link: ChatModelLink,
	) {
		this.terminal = terminal;
	}

	static async start(options: PiCodeSessionOptions): Promise<PiCodeSession> {
		// The session's own connection to the chat's model, through its LLM.
		const link = connectChatModel(options.getLlm);
		try {
			return await PiCodeSession.open(options, link);
		} catch (error) {
			link.dispose();
			throw error;
		}
	}

	private static async open(
		options: PiCodeSessionOptions,
		link: ChatModelLink,
	): Promise<PiCodeSession> {
		const home = options.home;
		const cwd = options.cwd ?? home;
		const agentDir = join(home, PI_CONFIG_DIR, "agent");
		const files = createPiFileSystem(options.fs);
		// pi works in a folder the agent named; it may not be there yet.
		const createdCwd = await options.fs.stat(cwd).then(
			() => false,
			() => true,
		);
		if (createdCwd) {
			await options.fs.mkdir(cwd, { recursive: true }).catch(() => undefined);
		}

		const [globalSettings, projectSettings, keybindingsText, resources, model] =
			await Promise.all([
				files.readText(join(agentDir, "settings.json")),
				files.readText(join(cwd, PI_CONFIG_DIR, "settings.json")),
				files.readText(join(agentDir, "keybindings.json")),
				loadSessionResources(
					options.fs,
					{ cwd, agentDir, environmentNote: ENVIRONMENT_NOTE },
					files.readText,
				),
				link.resolve().catch(() => undefined),
			]);

		const settingsManager = SettingsManager.fromStorage(
			new PreloadedSettingsStorage(
				{ global: globalSettings, project: projectSettings },
				(scope, content) => {
					const path =
						scope === "global"
							? join(agentDir, "settings.json")
							: join(cwd, PI_CONFIG_DIR, "settings.json");
					void files.writeText(path, content).catch(() => {});
				},
			),
		);
		const keybindings = KeybindingsManager.create(keybindingsText);

		const sessionDir =
			settingsManager.getSessionDir(home) ??
			getDefaultSessionDir(cwd, agentDir);
		const sessionManager = options.sessionFile
			? await SessionManager.open(
					options.sessionFile,
					files.sessions,
					sessionDir,
					cwd,
				)
			: SessionManager.create(cwd, sessionDir, files.sessions);

		const thinkingLevel = await PiCodeSession.initialThinkingLevel(
			options,
			settingsManager,
			model,
		);
		const tempFiles = files.tempFiles(join(agentDir, "tmp"));
		const bashOperations = createSandboxBashOperations(
			options.getSandbox,
			options.sandboxSessionKey,
		);

		const toolDefinitions = [
			createReadToolDefinition(cwd, {
				operations: files.read,
				home,
				autoResizeImages: settingsManager.getImageAutoResize(),
			}),
			createBashToolDefinition(cwd, {
				operations: bashOperations,
				tempFiles,
				commandPrefix: settingsManager.getShellCommandPrefix(),
			}),
			createEditToolDefinition(cwd, { operations: files.edit, home }),
			createWriteToolDefinition(cwd, { operations: files.write, home }),
			createGrepToolDefinition(cwd, { operations: files.grep, home }),
			createFindToolDefinition(cwd, { operations: files.find, home }),
			createLsToolDefinition(cwd, { operations: files.ls, home }),
		];

		const agent = new Agent({
			initialState: {
				systemPrompt: "",
				...(model ? { model } : {}),
				thinkingLevel,
				tools: [],
			},
			convertToLlm,
			sessionId: sessionManager.getSessionId(),
			steeringMode: settingsManager.getSteeringMode(),
			followUpMode: settingsManager.getFollowUpMode(),
			thinkingBudgets: settingsManager.getThinkingBudgets(),
		});
		// A resumed session goes on from its conversation.
		const restored = sessionManager.buildSessionContext();
		if (restored.messages.length > 0) agent.state.messages = restored.messages;

		const session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd,
			home,
			toolDefinitions,
			resources,
			bashOperations,
			tempFiles,
			readSkillFile: async (path) => {
				const text = await files.readText(path);
				if (text === undefined)
					throw new Error(`Skill file not found: ${path}`);
				return text;
			},
			resolveModel: () => link.resolve(),
		});
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}

		initTheme(options.theme);
		const terminal = new StreamTerminal(options.columns, options.rows);
		const footerData = new FooterDataProvider(cwd, files.readText);
		const mode = new InteractiveMode(session, terminal, {
			version: PI_VERSION,
			keybindings,
			footerData,
			autocompleteFileSystem: files.autocomplete(home),
			onboarding: `Model: the one selected in the chat composer. Files: this agent's Memon home (${home}).`,
			describeModelChange: "change it in the chat composer",
			onQuit: options.onQuit,
			onResume: options.onResume,
		});

		const piCode = new PiCodeSession(session, mode, terminal, footerData, link);
		piCode.createdCwd = createdCwd;
		terminal.onCompactRequest = () => piCode.redraw();
		mode.init();
		piCode.watch(options);
		return piCode;
	}

	/** The chat composer's effort for this model, else pi's saved default. */
	private static async initialThinkingLevel(
		options: PiCodeSessionOptions,
		settingsManager: SettingsManager,
		model: Model<any> | undefined,
	): Promise<ThinkingLevel> {
		const effort =
			model && options.getReasoningEffort
				? await options
						.getReasoningEffort(model.provider, model.id)
						.catch(() => undefined)
				: undefined;
		return (
			thinkingLevelForEffort(effort) ??
			settingsManager.getDefaultThinkingLevel() ??
			DEFAULT_THINKING_LEVEL
		);
	}

	private watch(options: PiCodeSessionOptions): void {
		let wasRunning = false;
		this.unsubscribers.push(
			this.session.subscribe((event) => {
				const running = this.status().running;
				if (running !== wasRunning || VIEW_EVENTS.has(event.type)) {
					wasRunning = running;
					options.onChange();
				}
			}),
		);
		// Follow the chat's model as soon as it changes, so the footer shows it.
		void options
			.getLlm()
			.then((llm) => {
				if (this.disposed) return;
				this.unsubscribers.push(
					llm.onCurrentModelChange(() => {
						void this.link
							.resolve()
							.then((model) => {
								if (!this.disposed) this.session.setModel(model);
							})
							.catch(() => {});
					}),
				);
			})
			.catch(() => {});
	}

	/** pi's current session (a new one after /new). */
	get sessionId(): string {
		return this.session.sessionId;
	}

	get cwd(): string {
		return this.session.cwd;
	}

	status(): PiCodeStatus {
		const model = this.session.model;
		return {
			// A retry waits between attempts: the turn has not ended yet.
			running:
				this.session.isStreaming ||
				this.session.isBashRunning ||
				this.session.isCompacting ||
				this.session.isRetrying,
			cwd: this.session.cwd,
			model: model ? `${model.provider}/${model.id}` : undefined,
			sessionName: this.session.sessionName,
		};
	}

	/** The conversation and what pi is doing, for the agent's screen. */
	view(): PiCodeView {
		const state = this.session.state;
		const messages = this.session.messages;
		const steering = this.session.getSteeringMessages();
		const followUp = this.session.getFollowUpMessages();
		const running = this.status().running;
		const key = [
			messages.length,
			messages.at(-1),
			state.streamingMessage,
			state.pendingToolCalls.size,
			steering.length,
			followUp.length,
			running,
			this.session.isCompacting,
			this.session.isRetrying,
			this.session.thinkingLevel,
			this.session.model,
		];
		const cached = this.viewCache;
		if (
			cached &&
			cached.key.length === key.length &&
			cached.key.every((value, index) => value === key[index])
		) {
			return cached.view;
		}
		const usage = this.session.getContextUsage();
		const view: PiCodeView = {
			...buildTranscript(messages, state.streamingMessage),
			thinkingLevel: this.session.thinkingLevel,
			contextPercent:
				usage?.percent === null || usage?.percent === undefined
					? undefined
					: Math.round(usage.percent),
			activity: running ? this.activity() : undefined,
			queued: [
				...steering.map((text) => ({ mode: "steer" as const, text })),
				...followUp.map((text) => ({ mode: "followUp" as const, text })),
			],
		};
		this.viewCache = { key, view };
		return view;
	}

	private activity(): string {
		const session = this.session;
		if (session.isCompacting) return "compacting the conversation";
		if (session.isRetrying) return "retrying after an error";
		if (session.isBashRunning) return "running a ! command";
		const state = session.state;
		if (state.pendingToolCalls.size) {
			const names = new Set<string>();
			for (const message of [...session.messages].reverse()) {
				if (message.role !== "assistant") continue;
				for (const part of message.content) {
					if (part.type === "toolCall" && state.pendingToolCalls.has(part.id))
						names.add(part.name);
				}
				break;
			}
			return names.size ? `running ${[...names].join(", ")}` : "running tools";
		}
		const streaming = state.streamingMessage;
		if (streaming?.role === "assistant") {
			const last = streaming.content.at(-1);
			if (last?.type === "thinking") return "thinking";
			if (last?.type === "toolCall") return `calling ${last.name}`;
			if (last?.type === "text") return "writing";
		}
		return "waiting for the model";
	}

	/**
	 * Hands pi a prompt, as if typed (but leaving the user's draft alone).
	 * While pi works it is queued as a steer or a follow-up.
	 */
	submit(text: string, queue?: "steer" | "followUp"): Promise<void> {
		if (this.disposed) return Promise.reject(new Error("pi code has quit."));
		return this.mode.submit(text, queue);
	}

	/** Stops pi's turn, ! command or compaction and drops its queue. */
	interrupt(): Promise<void> {
		return this.disposed ? Promise.resolve() : this.mode.interrupt();
	}

	/** Starts a new session, as /new does. */
	newSession(): Promise<void> {
		return this.disposed ? Promise.resolve() : this.mode.newSession();
	}

	/** Compacts the conversation, as /compact does. */
	compact(customInstructions?: string): Promise<void> {
		return this.disposed
			? Promise.resolve()
			: this.mode.compact(customInstructions);
	}

	/**
	 * Resolves true once pi is idle (and stays so a moment, as a queued
	 * message or an automatic compaction may follow a turn), false when it is
	 * still working after `timeoutMs` or the signal aborts.
	 */
	waitForIdle(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		return new Promise((resolve) => {
			let idleSince: number | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (idle: boolean) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve(idle);
			};
			const onAbort = () => finish(this.disposed || !this.status().running);
			const tick = () => {
				if (this.disposed) return finish(true);
				const running = this.status().running;
				if (running) {
					idleSince = undefined;
				} else {
					idleSince ??= Date.now();
					if (Date.now() - idleSince >= IDLE_SETTLE_MS) return finish(true);
				}
				if (Date.now() >= deadline) return finish(!running);
				timer = setTimeout(tick, IDLE_POLL_MS);
			};
			if (signal?.aborted) return onAbort();
			signal?.addEventListener("abort", onAbort);
			tick();
		});
	}

	/** A view connects: size pi to it and replay a full screen from the returned cursor. */
	attach(columns: number, rows: number, theme?: PiCodeTheme): number {
		if (theme) initTheme(theme);
		this.terminal.resize(columns, rows);
		return this.redraw();
	}

	/** Restart the output log at a full redraw. Returns the cursor it starts at. */
	redraw(): number {
		const cursor = this.terminal.restartLog();
		this.mode.redraw();
		return cursor;
	}

	read(
		cursor: number,
		waitMs: number,
		signal?: AbortSignal,
	): Promise<TerminalRead> {
		return this.terminal.read(cursor, waitMs, signal);
	}

	input(data: string): void {
		if (!this.disposed) this.terminal.input(data);
	}

	resize(columns: number, rows: number): void {
		if (!this.disposed) this.terminal.resize(columns, rows);
	}

	/** Stop pi: abort the model stream and any bash command, close the TUI. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
		this.session.dispose();
		this.mode.stop();
		this.link.dispose();
		this.footerData.dispose();
		this.terminal.release();
		await this.session.sessionManager.flush().catch(() => {});
	}
}
