import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";
import type { ConnectionStatus } from "@/services/mcp-connections/status";
import type { StudioContentPart } from "@/types/studio";
import type {
	MemonAppId,
	MemonBuiltinApp,
	MemonStudioToolId,
	MemonWindowApp,
} from "./constants";
import type { MemonViewerKind } from "./file-kinds";
import type { MemonStudioAppSettings } from "./studio-app-file";

export type MemonDriver = "agent" | "user";
export type MemonStatus = "idle" | "working" | "paused" | "waiting-for-user";

/** Window geometry as fractions of the desktop, so any panel size works. */
export interface MemonWindowState {
	id: string;
	app: MemonWindowApp;
	x: number;
	y: number;
	w: number;
	h: number;
	z: number;
	minimized: boolean;
	maximized: boolean;
}

export interface MemonBrowserTab {
	id: string;
	sessionId: string;
	/**
	 * "embedded": a page of a server started in the Terminal, shown in the
	 * Browser window itself (a real browser tab cannot reach it).
	 */
	kind?: "embedded";
	url: string;
	title: string;
	outline: WebPageOutline | null;
	/**
	 * Pages this tab has shown, for Back/Forward. Chrome skips history entries
	 * a page reached without a user gesture (every agent-driven navigation), so
	 * the tab keeps its own.
	 */
	history: string[];
	historyIndex: number;
	error?: string;
}

export interface MemonBrowserState {
	tabs: MemonBrowserTab[];
	activeTabId: string | null;
	/** Browser window the tabs share (extension window mode), when known. */
	windowId?: number;
}

export interface MemonFileEntry {
	name: string;
	path: string;
	type: "file" | "dir";
	size?: number;
}

/** Entries cut or copied in Files, waiting to be pasted. */
export interface MemonFileClipboard {
	mode: "copy" | "cut";
	paths: string[];
}

export interface MemonFilesState {
	cwd: string;
	entries: MemonFileEntry[];
	error?: string;
	/** Shared by the user and the agent, like a real clipboard. */
	clipboard?: MemonFileClipboard | null;
	/**
	 * The latest folder the agent zipped for the user. The Computer panel
	 * downloads each one to the user's machine once (by `id`).
	 */
	exported?: MemonFileExport | null;
}

export interface MemonFileExport {
	id: number;
	/** The zip in Files. */
	path: string;
	name: string;
	/** When it was made, so a panel opened much later does not download it. */
	at: number;
}

export interface MemonEditorState {
	path: string | null;
	content: string;
	saved: boolean;
	/** First line of the page the agent's screen shows (0-based). */
	screenLine: number;
	/**
	 * The file's text, when it changed on disk under unsaved edits. Saving
	 * would replace it, so a save is refused until the file is reloaded or
	 * overwritten on purpose.
	 */
	conflict?: string;
}

/**
 * Where a task stands. The agent proposes ("new") and the user approves;
 * a task the user adds or asks for in chat needs no approval.
 */
export type MemonTaskState =
	| "new"
	| "approved"
	| "in_progress"
	| "done"
	| "dropped";

export interface MemonTaskCheck {
	text: string;
	done: boolean;
}

/** A piece of work the user and the agent share, with its checklist. */
export interface MemonTask {
	/** Stable number, shown as #3; never reused. */
	id: number;
	title: string;
	state: MemonTaskState;
	checklist: MemonTaskCheck[];
	createdBy: "agent" | "user";
	createdAt: number;
	updatedAt: number;
	/** When it was last done or dropped. */
	finishedAt?: number;
}

/** The Tasks app: every task, kept in a `.tasks` file across chats. */
export interface MemonTasksState {
	/** Oldest first. */
	items: MemonTask[];
	/** The `.tasks` file they are kept in: ~/.tasks unless another is open. */
	path?: string;
	/** Why the file could not be read; the next change writes it again. */
	error?: string;
}

export type MemonScheduleStatus = "active" | "paused" | "draft";

/** One of the agent's scheduled prompts, as the Scheduler shows it. */
export interface MemonSchedule {
	id: string;
	name: string;
	status: MemonScheduleStatus;
	/** 5-field cron, local time. */
	scheduleExpression: string;
	prompt: string;
	/** The schedule form's hints: daily / weekly / raw, time, weekday. */
	metadata?: Record<string, unknown>;
	nextRunAt?: number;
	lastRunAt?: number;
	lastStatus?: string;
	lastError?: string;
}

/** The Scheduler app: the scheduled prompts of the agent using the computer. */
export interface MemonSchedulerState {
	agentId: string | null;
	agentName?: string;
	items: MemonSchedule[];
	loading: boolean;
	error?: string;
}

/** A skill in the Skills app, and whether the agent uses it. */
export interface MemonSkillItem {
	name: string;
	description: string;
	origin: "default" | "custom";
	readOnly: boolean;
	enabled: boolean;
}

/** The skill open in the Skills app. */
export interface MemonOpenSkill {
	name: string;
	description: string;
	body: string;
	origin: "default" | "custom";
	readOnly: boolean;
}

export interface MemonSkillsState {
	agentId: string | null;
	agentName?: string;
	items: MemonSkillItem[];
	open: MemonOpenSkill | null;
	loading: boolean;
	error?: string;
}

export interface MemonConnectionTool {
	name: string;
	description: string;
	readOnly?: boolean;
	destructive?: boolean;
}

/**
 * One provider the user can grant the agent: a Composio app, or a whole
 * server connection.
 */
export interface MemonConnectionItem {
	key: string;
	connectionId: string;
	label: string;
	connectionName: string;
	kind: "composio" | "template" | "custom";
	appId?: string;
	logo?: string;
	status: ConnectionStatus;
	granted: boolean;
	tools: MemonConnectionTool[];
	error?: string;
}

export interface MemonConnectionsState {
	agentId: string | null;
	agentName?: string;
	items: MemonConnectionItem[];
	/** The passkey is unlocked, so saved credentials can be used. */
	unlocked: boolean;
	/** The connection whose tools are shown. */
	selected: string | null;
	loading: boolean;
	error?: string;
}

export interface MemonStudioToolState {
	id: MemonStudioToolId;
	ready: boolean;
	/** The model chosen for this studio. */
	model?: string;
	/** Why the tool cannot run, e.g. no model chosen. */
	reason?: string;
	/** What the model does, for Image tools and Text tools. */
	task?: string;
	/** Voices the speech model offers. */
	voices?: string[];
}

export type MemonStudioRunStatus = "running" | "done" | "failed";

/** One studio run on the computer, by the agent. */
export interface MemonStudioRun {
	id: string;
	tool: MemonStudioToolId;
	status: MemonStudioRunStatus;
	/** The input in short: the text, prompt or file. */
	input: string;
	/** The result as text: what the agent reads. */
	text?: string;
	/** The result as the Studio stores it: audio, images, labels, answers. */
	parts: StudioContentPart[];
	model?: string;
	error?: string;
	startedAt: number;
	/** The `.studio` app it ran with, by title. */
	app?: string;
	/** Where the run is kept in Studio history. */
	conversationId?: string;
	itemId?: string;
}

/** A `.studio` file open in Studio: a tool set up for one job. */
export interface MemonStudioAppFile {
	path: string;
	title: string;
	tool: MemonStudioToolId;
	/** Its settings; the form's fields go over them. */
	settings: MemonStudioAppSettings;
}

export interface MemonStudioState {
	tools: MemonStudioToolState[];
	/** The `.studio` app the form was filled from, if any. */
	app?: MemonStudioAppFile | null;
	/** The tool whose runs the window shows; null shows them all. */
	selected: MemonStudioToolId | null;
	runs: MemonStudioRun[];
	loading: boolean;
	error?: string;
}

/** A file the Editor cannot show as text: PDF, image, media, spreadsheet. */
export interface MemonViewerState {
	path: string | null;
	kind: MemonViewerKind | null;
	size?: number;
	/**
	 * What the agent reads: extracted text for PDFs and spreadsheets, a short
	 * description for images and media. The user sees the real preview.
	 */
	text: string;
	loading: boolean;
	error?: string;
	screenLine: number;
}

export type MemonTerminalLineKind =
	| "command"
	| "stdout"
	| "stderr"
	| "system"
	/** Typed into a running command (its stdin). */
	| "input";

export interface MemonTerminalLine {
	kind: MemonTerminalLineKind;
	text: string;
	cwd?: string;
	/**
	 * Printed without a newline yet (a prompt waiting for an answer, a
	 * progress line): what comes next continues it on screen.
	 */
	partial?: boolean;
}

/** A command of the agent's that waits for the user's go-ahead. */
export interface MemonTerminalApproval {
	id: string;
	command: string;
	gate: "installs" | "deletes";
	reason: string;
	requestedAt: number;
	/** The agent's tool call is waiting on the answer. */
	agentWaiting: boolean;
	/** The Terminal tab the command runs in once approved. */
	terminalId?: string;
}

/** A Terminal tab: its own working directory and output. */
export interface MemonTerminalTab {
	id: string;
	cwd: string;
	/** The running command belongs to this tab. */
	running: boolean;
	/** The command running in it, or the last one it ran. */
	command?: string;
	/** The last command's exit code, once it finished. */
	lastExitCode?: number | null;
	/** Commands run in this tab, oldest first (the latest few). */
	recent?: string[];
}

/**
 * The Terminal: `cwd`, `lines` and `lastExitCode` are the tab in front's.
 * One command keeps running at a time, in `runningTabId`'s tab.
 */
export interface MemonTerminalState {
	cwd: string;
	lines: MemonTerminalLine[];
	/**
	 * The front tab's lines dropped before `lines` (it keeps the latest only):
	 * `lines[0]` is line `lineOffset` of its screen.
	 */
	lineOffset?: number;
	/** The front tab's screen: a new one after `clear`, so it is drawn anew. */
	screenId?: number;
	runningProcessId: string | null;
	/** The command that is running, from the moment it starts. */
	runningCommand: string | null;
	startedAt: number | null;
	/** When the running command last printed something. */
	lastOutputAt: number | null;
	lastExitCode: number | null;
	approval: MemonTerminalApproval | null;
	/** Ports of servers running in the sandbox (the Browser embeds them). */
	servers?: number[];
	tabs: MemonTerminalTab[];
	activeTabId: string;
	runningTabId: string | null;
	/** The running tab's last lines, while another tab is in front. */
	runningTabTail?: MemonTerminalLine[];
	/** Commands run before, oldest first, as the history file keeps them. */
	history?: string[];
	/** The file the history is kept in: ~/.terminal_history. */
	historyPath?: string;
}

export interface MemonAppAvailability {
	id: MemonAppId;
	enabled: boolean;
	available: boolean;
	reason?: string;
}

/** Where the agent's cursor points: a window, optionally one ref in it. */
export interface MemonCursorState {
	windowId: string | null;
	ref?: string;
	label: string;
	at: number;
}

export interface MemonMachineSnapshot {
	key: string;
	revision: number;
	driver: MemonDriver;
	status: MemonStatus;
	apps: MemonAppAvailability[];
	/** The built-in apps this computer has (pi code can be turned off). */
	builtInApps?: MemonBuiltinApp[];
	windows: MemonWindowState[];
	focusedWindowId: string | null;
	browser: MemonBrowserState;
	files: MemonFilesState;
	editor: MemonEditorState;
	viewer: MemonViewerState;
	tasks: MemonTasksState;
	scheduler: MemonSchedulerState;
	studio: MemonStudioState;
	skills: MemonSkillsState;
	connections: MemonConnectionsState;
	terminal: MemonTerminalState;
	/**
	 * What is in the agent's home, drawn as the desktop: Bot.md, Memory.md
	 * and everything else in it, hidden (dot) files left out.
	 */
	desktop: MemonFileEntry[];
	visual: MemonVisualState;
	/** pi code, while its window is open (absent before it is opened). */
	piCode?: MemonPiCodeState;
	/** The agent's home folder, `/agents/<agent name>` (shown as `~`). */
	home: string;
	cursor: MemonCursorState | null;
	/** User changes the agent has not read yet. */
	pendingUserChanges: string[];
	/**
	 * What is typed into the apps' fields (a new task, a studio prompt, a
	 * skill being written), by key. Held here so the user and the agent fill
	 * the same form.
	 */
	drafts: Record<string, unknown>;
	updatedAt: number;
}

/** The slim bus message; the full snapshot is pulled on demand. */
export interface MemonMachineSummary {
	key: string;
	revision: number;
	driver: MemonDriver;
	status: MemonStatus;
	focusedWindowId: string | null;
	windows: Array<Pick<MemonWindowState, "id" | "app" | "minimized">>;
	cursor: MemonCursorState | null;
	/** Whether the UI should open Runtime → Computer when this machine works. */
	showComputer: "auto" | "manual";
	updatedAt: number;
	disposed?: boolean;
}

/**
 * pi code: the pi coding agent, running in the computer with the chat's
 * model. Its screen is a terminal the window streams, not snapshot fields.
 */
export interface MemonPiCodeState {
	/** idle: nothing runs yet, only the agent's request waits. */
	status: "idle" | "starting" | "running" | "error";
	/** pi is busy: a model turn, a tool, a ! command or compaction. */
	working: boolean;
	cwd?: string;
	/** provider/model its next turn uses. */
	model?: string;
	thinkingLevel?: string;
	/** Share of the model's context window in use, 0–100. */
	contextPercent?: number;
	sessionName?: string;
	error?: string;
	/** What pi does right now, e.g. "running bash", while it works. */
	activity?: string;
	/**
	 * Which start of pi this is. pi starts again on /resume and in another
	 * folder, sometimes faster than a view sees "starting": a view attaches
	 * again whenever it changes.
	 */
	instance?: number;
	/** pi's conversation, oldest first, the latest entries only. */
	transcript?: MemonPiCodeEntry[];
	/** Entries before the transcript that are left out. */
	earlier?: number;
	/** Messages waiting for pi's next turn, in order. */
	queued?: MemonPiCodeQueued[];
	/** The agent asks to use pi code; the user answers in the window. */
	approval?: MemonPiCodeApproval;
}

/** One entry of pi's conversation, as the agent and the panel read it. */
export interface MemonPiCodeEntry {
	kind: "user" | "assistant" | "tool" | "bash" | "summary" | "error";
	text: string;
	/** A tool's name. */
	name?: string;
	/** A tool or ! command that failed. */
	failed?: boolean;
}

export interface MemonPiCodeQueued {
	mode: "steer" | "followUp";
	text: string;
}

/** The agent waits for the user to let it hand work to pi code. */
export interface MemonPiCodeApproval {
	id: string;
	/** The work the agent would give pi. */
	task: string;
	requestedAt: number;
}

/** The Visualize window: one visual, kept as an OpenUI Lang file. */
export interface MemonVisualState {
	/** Its file; null before anything is shown. */
	path: string | null;
	title: string;
	/** OpenUI Lang, as the file holds it. */
	source: string;
	theme: "shadcn" | "wireframe" | "glass";
	/** First source line on the agent's screen. */
	screenLine: number;
	error?: string;
}
