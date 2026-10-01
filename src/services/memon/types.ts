import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";
import type { ConnectionStatus } from "@/services/mcp-connections/status";
import type { StudioContentPart } from "@/types/studio";
import type {
	MemonAppId,
	MemonStudioToolId,
	MemonWindowApp,
} from "./constants";
import type { MemonViewerKind } from "./file-kinds";

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
}

export interface MemonEditorState {
	path: string | null;
	content: string;
	saved: boolean;
	/** First line of the page the agent's screen shows (0-based). */
	screenLine: number;
}

export type MemonNoteStatus = "todo" | "doing" | "done";

export interface MemonNoteItem {
	id: string;
	text: string;
	status: MemonNoteStatus;
}

/** The Notes app: the task's checklist and free-form notes. */
export interface MemonNotesState {
	items: MemonNoteItem[];
	text: string;
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
	/** Where the run is kept in Studio history. */
	conversationId?: string;
	itemId?: string;
}

export interface MemonStudioState {
	tools: MemonStudioToolState[];
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
}

export interface MemonTerminalState {
	cwd: string;
	lines: MemonTerminalLine[];
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
	windows: MemonWindowState[];
	focusedWindowId: string | null;
	browser: MemonBrowserState;
	files: MemonFilesState;
	editor: MemonEditorState;
	viewer: MemonViewerState;
	notes: MemonNotesState;
	scheduler: MemonSchedulerState;
	studio: MemonStudioState;
	skills: MemonSkillsState;
	connections: MemonConnectionsState;
	terminal: MemonTerminalState;
	/** What is in /Desktop: Bot.md, Memory.md and anything else put there. */
	desktop: MemonFileEntry[];
	visual: MemonVisualState;
	/** The agent's home folder (shown as `~`), holding its Desktop. */
	home: string;
	cursor: MemonCursorState | null;
	/** User changes the agent has not read yet. */
	pendingUserChanges: string[];
	/**
	 * What is typed into the apps' fields (a new step, a studio prompt, a
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
