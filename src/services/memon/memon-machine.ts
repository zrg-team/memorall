import type {
	WebHistoryDirection,
	WebOutlineActionRequest,
	WebOutlineActionResult,
	WebPageOutline,
} from "@/services/web-browser/web-browser-protocol";
import {
	MEMON_AGENT_TURN_CEILING_MS,
	MEMON_APP_IDS,
	MEMON_BUILTIN_APPS,
	MEMON_GUEST_HOME,
	MEMON_STUDIO_EXTENSION,
	MEMON_TASKS_EXTENSION,
	MEMON_TERMINAL_EXTENSION,
	MEMON_VISUAL_EXTENSION,
	MEMON_VISUALS_DIR,
	memonDisplayPath,
	memonHomePaths,
	MEMON_TEXT_PAGE_LINES,
	type MemonAppId,
	type MemonBuiltinApp,
	type MemonStudioToolId,
	type MemonWindowApp,
} from "./constants";
import { MemonFileSync } from "./file-sync";
import { isTaskOpen, parseTasksFile, serializeTasksFile } from "./tasks-file";
import {
	parseTerminalHistory,
	parseTerminalLauncher,
	serializeTerminalHistory,
	serializeTerminalLauncher,
} from "./terminal/terminal-history";
import {
	type MemonStudioAppConfig,
	parseStudioAppFile,
	serializeStudioAppFile,
} from "./studio-app-file";
import {
	DEFAULT_MEMON_FEATURE_CONFIG,
	type MemonFeatureConfig,
} from "./feature-config";
import { validateCronExpression } from "@/services/cron-jobs/cron-expression";
import {
	changeDesktopEntries,
	listDesktopEntries,
	loadMemonDesktopFiles,
	MEMON_BOT_TEMPLATE,
	MEMON_MEMORY_TEMPLATE,
	migrateMemonHomeFiles,
	type MemonDesktopEntryChange,
} from "./desktop-files";
import { memonFileKind, type MemonViewerKind } from "./file-kinds";
import {
	downloadFileName,
	MEMON_DOWNLOADS_DIR,
	MEMON_PICTURES_DIR,
} from "./download";
import type { FolderZip } from "@/services/filesystem/folder-zip";
import { listFileRefs, serializeScreen } from "./screen-serializer";
import { controlsByRef } from "./app-kit/render-text";
import type { MemonControlValue } from "./app-kit/types";
import { kitAppForRef } from "./apps";
import { studioDraftsFromSettings } from "./apps/studio-view";
import { MemonApprovalRequiredError } from "./approval-error";
import {
	MemonPiCode,
	type MemonPiCodePort,
	type PiCodeOpened,
} from "./apps/pi-code/pi-code-app";
import type { MemonEmbeddedPort } from "./embedded-browser";
import type { MemonModelsPort } from "./models-port";
import type { MemonCaptureRequest, MemonPageCapture } from "./page-capture";
import {
	isLocalAddress,
	isLoopbackUrl,
	sandboxTargetOf,
} from "./embedded-frame";
import type { MemonStudioPort, MemonStudioRequest } from "./studio-app";
import {
	MemonTerminal,
	type MemonTerminalPort,
} from "./terminal/memon-terminal";
import type {
	MemonAppAvailability,
	MemonBrowserTab,
	MemonCursorState,
	MemonDriver,
	MemonFileClipboard,
	MemonFileExport,
	MemonFileEntry,
	MemonMachineSnapshot,
	MemonSchedule,
	MemonScheduleStatus,
	MemonMachineSummary,
	MemonStatus,
	MemonConnectionItem,
	MemonOpenSkill,
	MemonPiCodeBrowse,
	MemonSkillItem,
	MemonStudioAppFile,
	MemonStudioRun,
	MemonStudioToolState,
	MemonTask,
	MemonTaskState,
	MemonWindowState,
} from "./types";

// ─── Ports: the existing services, behind narrow interfaces ──────────────────

export interface MemonAvailability {
	available: boolean;
	reason?: string;
}

export interface MemonBrowserPort {
	availability(): MemonAvailability;
	open(
		url: string,
		options: { windowId?: number },
	): Promise<{
		sessionId: string;
		windowId?: number;
		url: string;
		title: string;
	}>;
	navigate(
		sessionId: string,
		url: string,
	): Promise<{ url: string; title: string }>;
	outline(sessionId: string): Promise<WebPageOutline>;
	/**
	 * The outline once the page holds still: a page its own scripts draw is
	 * still filling in when the browser reports it loaded. Without it, the
	 * page is read as it is.
	 */
	settle?(
		sessionId: string,
		options: { timeoutMs: number },
	): Promise<WebPageOutline>;
	act(
		sessionId: string,
		request: WebOutlineActionRequest,
	): Promise<{ result: WebOutlineActionResult; outline?: WebPageOutline }>;
	history(sessionId: string, direction: WebHistoryDirection): Promise<void>;
	/** A picture of an element of the page; without it, pages are text only. */
	capture?(
		sessionId: string,
		request: MemonCaptureRequest,
	): Promise<MemonPageCapture>;
	/** Brings the session's real tab and window to the front. */
	focus(sessionId: string): Promise<void>;
	close(sessionId: string): Promise<void>;
	/** Keeps the session alive and out of web-feature cleanup until released. */
	reserve(sessionId: string): () => void;
}

export interface MemonFilesPort {
	availability(): MemonAvailability;
	list(dir: string): Promise<MemonFileEntry[]>;
	read(path: string): Promise<string>;
	/** Text, or the bytes of a file that is not text (a download). */
	write(path: string, content: string | Uint8Array): Promise<void>;
	isDirectory(path: string): Promise<boolean>;
	exists(path: string): Promise<boolean>;
	/** Moves or renames a file or folder. */
	move(from: string, to: string): Promise<void>;
	/** Copies a file, or a folder with everything in it. */
	copy(from: string, to: string): Promise<void>;
	/** Deletes a file, or a folder with everything in it. */
	remove(path: string): Promise<void>;
	/** A folder with everything in it, as one zip. */
	zip(folder: string): Promise<FolderZip>;
	subscribe(listener: () => void): () => void;
	/** What the agent reads of a file the Viewer shows. */
	preview(
		path: string,
		kind: MemonViewerKind,
	): Promise<{ text: string; size?: number }>;
}

export interface MemonScheduleInput {
	id?: string;
	name: string;
	prompt: string;
	scheduleExpression: string;
	status: MemonScheduleStatus;
	metadata?: Record<string, unknown>;
}

/** The agent's scheduled prompts (the cron job service). */
export interface MemonSchedulerPort {
	list(
		agentId: string,
	): Promise<{ agentName?: string; items: MemonSchedule[] }>;
	save(agentId: string, input: MemonScheduleInput): Promise<MemonSchedule>;
	remove(id: string): Promise<void>;
}

/** The skill library and which skills the agent uses. */
export interface MemonSkillsPort {
	list(agentId: string | null): Promise<{
		agentName?: string;
		items: MemonSkillItem[];
	}>;
	read(name: string): Promise<MemonOpenSkill>;
	setEnabled(agentId: string, name: string, enabled: boolean): Promise<void>;
	save(skill: {
		name: string;
		description: string;
		body: string;
	}): Promise<void>;
	remove(name: string): Promise<void>;
}

/** The user's connections and which ones the agent may use. */
export interface MemonConnectionsPort {
	list(agentId: string | null): Promise<{
		agentName?: string;
		unlocked: boolean;
		items: MemonConnectionItem[];
	}>;
	setGranted(agentId: string, key: string, granted: boolean): Promise<void>;
	/** Asks a connection for its tools again. */
	refresh(connectionId: string): Promise<void>;
}

/** Fetches a file from the web, to save into Files. */
export interface MemonDownloadPort {
	fetch(
		url: string,
	): Promise<{ bytes: Uint8Array; contentType: string; url: string }>;
}

/** Agents' homes, `/agents/<agent name>`. */
export interface MemonHomePort {
	/**
	 * The agent's home, made ready: the folder with Bot.md and Memory.md, and
	 * what an older version kept elsewhere moved in. No agent: the guest's.
	 */
	resolve(agentId: string | null): Promise<string>;
	/** Moves an agent's home after a rename; returns the new home. */
	rename(fromName: string, toName: string): Promise<string>;
}

export interface MemonPorts {
	browser: MemonBrowserPort;
	/** Pages of servers started in the Terminal, shown in the window. */
	embedded?: MemonEmbeddedPort;
	files: MemonFilesPort;
	terminal: MemonTerminalPort;
	scheduler: MemonSchedulerPort;
	studio: MemonStudioPort;
	skills: MemonSkillsPort;
	connections: MemonConnectionsPort;
	download?: MemonDownloadPort;
	/** Without it the computer stays in the home it is given. */
	homes?: MemonHomePort;
	/** Without it pi code is not available. */
	piCode?: MemonPiCodePort;
	/** Without it the agent gets pictures of pages as files, never to look at. */
	models?: MemonModelsPort;
}

export type MemonTurnOutcome = "ready" | "timeout" | "cancelled";

// ─── Layout ───────────────────────────────────────────────────────────────────

const DEFAULT_LAYOUT: Record<
	MemonWindowApp,
	Pick<MemonWindowState, "x" | "y" | "w" | "h">
> = {
	browser: { x: 0.08, y: 0.04, w: 0.6, h: 0.84 },
	files: { x: 0.53, y: 0.06, w: 0.44, h: 0.5 },
	terminal: { x: 0.27, y: 0.5, w: 0.66, h: 0.46 },
	editor: { x: 0.37, y: 0.05, w: 0.56, h: 0.6 },
	viewer: { x: 0.2, y: 0.04, w: 0.62, h: 0.86 },
	tasks: { x: 0.6, y: 0.04, w: 0.38, h: 0.8 },
	scheduler: { x: 0.18, y: 0.06, w: 0.6, h: 0.78 },
	studio: { x: 0.14, y: 0.05, w: 0.66, h: 0.82 },
	skills: { x: 0.2, y: 0.05, w: 0.6, h: 0.82 },
	connections: { x: 0.24, y: 0.06, w: 0.56, h: 0.8 },
	visualize: { x: 0.12, y: 0.04, w: 0.7, h: 0.88 },
	pi: { x: 0.1, y: 0.04, w: 0.74, h: 0.88 },
};
/** The app each window needs turned on; built-in apps need none. */
const APP_OF_WINDOW: Record<MemonWindowApp, MemonAppId | null> = {
	browser: "browser",
	files: "files",
	editor: "files",
	viewer: "files",
	terminal: "terminal",
	tasks: "tasks",
	visualize: "visualize",
	scheduler: null,
	studio: null,
	skills: null,
	connections: null,
	pi: null,
};
/** Extracted text kept for the agent; a very long PDF is cut here. */
const MAX_VIEWER_TEXT_CHARS = 60_000;
const MAX_USER_CHANGES = 12;
const MAX_STUDIO_RUNS = 20;
/** How long a local address waits for a starting command's server. */
const SERVER_START_WAIT_MS = 3_000;
/** How long an opened page gets to draw itself before it is read. */
const PAGE_OPEN_SETTLE_MS = 10_000;
/** A page read again (the screen) is usually drawn already; it gets less. */
const PAGE_READ_SETTLE_MS = 3_000;
const normalizePath = (path: string, cwd = "/"): string => {
	const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
	const parts: string[] = [];
	for (const part of absolute.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};
/** A visual's title: its root CardBlock's, else its file's name. */
export const visualTitle = (source: string, path: string | null): string => {
	const match = /root\s*=\s*CardBlock\(\s*"((?:[^"\\]|\\.)*)"/.exec(source);
	if (match?.[1]) {
		try {
			return JSON.parse(`"${match[1]}"`) as string;
		} catch {
			return match[1];
		}
	}
	const name = path
		?.split("/")
		.pop()
		?.replace(/\.openui$/, "");
	return name || "Untitled visual";
};

/** A title as a file name: readable, without characters files cannot hold. */
const visualFileName = (title: string): string =>
	title
		.replace(/[\\/:*?"<>|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 60) || "Visual";

const parentOf = (path: string): string =>
	path.replace(/\/[^/]+\/?$/, "") || "/";

export const normalizeBrowserUrl = (input: string): string => {
	const value = input.trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
	if (isLocalAddress(value)) return `http://${value}`;
	if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(value))
		return `https://${value}`;
	return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
};

interface Waiter {
	resolve: (outcome: MemonTurnOutcome) => void;
	timer: ReturnType<typeof setTimeout>;
}

// ─── Machine ──────────────────────────────────────────────────────────────────

/**
 * One conversation's computer: windows, focus, the apps' state, who is
 * driving, and what the user changed while they were. Tools and the Computer
 * panel both go through here; `serializeScreen(snapshot())` is what the model
 * reads and the panel draws.
 */
export class MemonMachine {
	private revision = 0;
	private driver: MemonDriver = "agent";
	private paused = false;
	private busy = 0;
	private config: MemonFeatureConfig;
	private windows: MemonWindowState[] = [];
	private focusedWindowId: string | null = null;
	private windowSeq = 0;
	private zSeq = 10;
	private tabs: MemonBrowserTab[] = [];
	private activeTabId: string | null = null;
	private browserWindowId: number | undefined;
	private tabSeq = 0;
	/** The agent's home, `/agents/<agent name>`: where Files and the Terminal start. */
	private homeDir: string = MEMON_GUEST_HOME;
	private filesCwd: string = MEMON_GUEST_HOME;
	private fileEntries: MemonFileEntry[] = [];
	private filesError: string | undefined;
	private fileClipboard: MemonFileClipboard | null = null;
	private fileExport: MemonFileExport | null = null;
	private visualPath: string | null = null;
	private visualSource = "";
	private visualScreenLine = 0;
	private visualError: string | undefined;
	private editorPath: string | null = null;
	private editorContent = "";
	private editorSaved = true;
	private editorScreenLine = 0;
	/** The file text the Editor's content is based on; null for a new file. */
	private editorBase: string | null = null;
	/** The file's text, when it changed on disk under unsaved edits. */
	private editorConflict: string | null = null;
	private unsubscribeEditorFile: (() => void) | undefined;
	private editorRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private viewerPath: string | null = null;
	private viewerKind: MemonViewerKind | null = null;
	private viewerText = "";
	private viewerSize: number | undefined;
	private viewerLoading = false;
	private viewerError: string | undefined;
	private viewerScreenLine = 0;
	private taskItems: MemonTask[] = [];
	/** The `.tasks` file open in Tasks; null is ~/.tasks. */
	private tasksPath: string | null = null;
	private tasksError: string | undefined;
	private readonly tasksSync: MemonFileSync;
	/** The history is kept in ~/.terminal_history. */
	private readonly historySync: MemonFileSync;
	private agentId: string | null = null;
	private agentName: string | undefined;
	private schedules: MemonSchedule[] = [];
	private schedulesLoading = false;
	private schedulesError: string | undefined;
	private studioTools: MemonStudioToolState[] = [];
	private studioSelected: MemonStudioToolId | null = null;
	/** The `.studio` app the form was filled from. */
	private studioAppFile: MemonStudioAppFile | null = null;
	private studioRuns: MemonStudioRun[] = [];
	private studioLoading = false;
	private studioError: string | undefined;
	private studioSeq = 0;
	private skillItems: MemonSkillItem[] = [];
	private openedSkill: MemonOpenSkill | null = null;
	private skillsLoading = false;
	private skillsError: string | undefined;
	private connectionItems: MemonConnectionItem[] = [];
	private connectionsUnlocked = false;
	private selectedConnection: string | null = null;
	private connectionsLoading = false;
	private connectionsError: string | undefined;
	/** The Terminal: its tabs, commands and servers. */
	readonly terminal: MemonTerminal;
	/** pi code: runs while its window is open, with or without a view. */
	readonly piCode: MemonPiCode;
	private disposed = false;
	private cursor: MemonCursorState | null = null;
	private userChanges: string[] = [];
	private drafts = new Map<string, unknown>();
	/** The run the agent last acted in, and the one a takeover interrupted. */
	private activeRunId: string | null = null;
	private takeoverRunId: string | null = null;
	private readonly waiters = new Set<Waiter>();
	private readonly releases = new Map<string, () => void>();
	private readonly listeners = new Set<() => void>();
	private unsubscribeFiles: (() => void) | undefined;
	private filesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	private desktopEntries: MemonFileEntry[] = [];
	private unsubscribeDesktop: (() => void) | undefined;
	private desktopRefreshTimer: ReturnType<typeof setTimeout> | undefined;
	lastActiveAt = Date.now();

	constructor(
		readonly key: string,
		private readonly ports: MemonPorts,
		config: MemonFeatureConfig = DEFAULT_MEMON_FEATURE_CONFIG,
	) {
		this.config = config;
		this.tasksSync = new MemonFileSync(ports.files, "the tasks");
		this.historySync = new MemonFileSync(ports.files, "the command history");
		this.terminal = new MemonTerminal(
			{
				sessionKey: key,
				requireApp: () => this.requireApp("terminal"),
				askBefore: () => this.config.askBefore,
				showWindow: () => this.focusWindow(this.openWindow("terminal").id),
				awaitUser: () => {
					if (this.cursor) {
						this.cursor = {
							...this.cursor,
							label: "Waiting for your approval",
						};
					}
				},
				changed: () => this.changed(),
				home: () => this.homeDir,
				historyChanged: () =>
					this.historySync.save(
						this.historyFile,
						serializeTerminalHistory(this.terminal.history),
					),
				openPiCode: (cwd, options) => this.openPiCode(cwd, options),
			},
			ports,
		);
		this.piCode = new MemonPiCode(
			{
				sessionKey: key,
				home: () => this.home,
				agentId: () => this.agentId,
				changed: () => this.changed(),
				quit: () => {
					const window = this.windowFor("pi");
					if (window) void this.closeWindow(window.id);
				},
				enabled: () => this.config.piCode,
				show: () => {
					const opened = !this.windowFor("pi");
					this.openWindow("pi");
					return opened;
				},
				inFront: () => {
					const window = this.windowFor("pi");
					return Boolean(
						window && !window.minimized && window.id === this.focusedWindowId,
					);
				},
				cursorLabel: (label) => {
					if (this.cursor) this.cursor = { ...this.cursor, label };
				},
				runId: () => this.activeRunId,
			},
			ports.piCode,
		);
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	configure(config: MemonFeatureConfig): void {
		this.config = config;
		// Turned off: pi code leaves the desktop, and quits if it runs.
		const pi = config.piCode ? undefined : this.windowFor("pi");
		if (pi) void this.closeWindow(pi.id);
		this.changed();
	}

	getConfig(): MemonFeatureConfig {
		return this.config;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		this.revision += 1;
		this.lastActiveAt = Date.now();
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// A broken subscriber must not break the machine.
			}
		}
	}

	/** Waits for the tasks and history writes started so far. */
	async flushWrites(): Promise<void> {
		await Promise.all([this.tasksSync.flush(), this.historySync.flush()]);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.flushWrites();
		this.terminal.dispose();
		await this.piCode.stop();
		this.cancelWaits();
		this.unsubscribeFiles?.();
		this.unsubscribeDesktop?.();
		this.unwatchEditorFile();
		if (this.desktopRefreshTimer) clearTimeout(this.desktopRefreshTimer);
		if (this.filesRefreshTimer) clearTimeout(this.filesRefreshTimer);
		for (const release of this.releases.values()) release();
		this.releases.clear();
		await Promise.all(
			this.tabs.map((tab) =>
				this.browserPort(tab)
					.close(tab.sessionId)
					.catch(() => undefined),
			),
		);
		this.tabs = [];
		this.listeners.clear();
	}

	// ── Driver lock ─────────────────────────────────────────────────────────

	get status(): MemonStatus {
		if (this.driver === "user") return "waiting-for-user";
		if (this.paused) return "paused";
		return this.busy > 0 ? "working" : "idle";
	}

	get currentDriver(): MemonDriver {
		return this.driver;
	}

	/**
	 * Marks the run a tool call belongs to. A takeover belongs to the run it
	 * interrupted: a new run means the user sent a new message, which hands
	 * the computer back, so the agent never waits on a Resume nobody presses.
	 */
	beginRun(runId: string): void {
		if (this.driver === "user" && this.takeoverRunId !== runId) {
			this.resume();
		}
		this.activeRunId = runId;
	}

	takeOver(): void {
		if (this.driver === "user") return;
		this.driver = "user";
		this.takeoverRunId = this.activeRunId;
		this.cursor = this.cursor
			? { ...this.cursor, label: "Waiting for you" }
			: null;
		this.changed();
	}

	resume(): void {
		this.driver = "agent";
		this.paused = false;
		this.wakeWaiters();
		this.changed();
	}

	pause(): void {
		if (this.paused) return;
		this.paused = true;
		this.changed();
	}

	/** Releases every parked tool call, e.g. when the user presses Stop. */
	cancelWaits(): void {
		this.terminal.cancelWaits();
		this.piCode.cancelWaits();
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve("cancelled");
		}
		this.waiters.clear();
	}

	/**
	 * Parks a tool call while the user drives or the run is paused. Tool
	 * signals never fire in chat runs, so the wait has its own ceiling.
	 */
	waitForAgentTurn(
		ceilingMs = MEMON_AGENT_TURN_CEILING_MS,
	): Promise<MemonTurnOutcome> {
		if (this.driver === "agent" && !this.paused) {
			return Promise.resolve("ready");
		}
		return new Promise((resolve) => {
			const waiter: Waiter = {
				resolve,
				timer: setTimeout(() => {
					this.waiters.delete(waiter);
					resolve("timeout");
				}, ceilingMs),
			};
			this.waiters.add(waiter);
		});
	}

	private wakeWaiters(): void {
		if (this.driver !== "agent" || this.paused) return;
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer);
			waiter.resolve("ready");
		}
		this.waiters.clear();
	}

	/** Records what the user did on the computer; the agent reads it next. */
	noteUserChange(text: string): void {
		if (this.userChanges[this.userChanges.length - 1] === text) return;
		this.userChanges.push(text);
		if (this.userChanges.length > MAX_USER_CHANGES) this.userChanges.shift();
		this.changed();
	}

	/** Screen for the model; clears the change log it reports. */
	readScreen(): string {
		const screen = serializeScreen(this.snapshot());
		if (this.userChanges.length) {
			this.userChanges = [];
			this.changed();
		}
		return screen;
	}

	async runAgentAction<T>(
		label: string,
		target: { windowId?: string | null; ref?: string },
		action: () => Promise<T>,
	): Promise<T> {
		this.busy += 1;
		this.cursor = {
			windowId: target.windowId ?? this.focusedWindowId,
			ref: target.ref,
			label,
			at: Date.now(),
		};
		this.changed();
		try {
			return await action();
		} finally {
			this.busy -= 1;
			this.changed();
		}
	}

	// ── Gates ───────────────────────────────────────────────────────────────

	private appAvailability(app: MemonAppId): MemonAvailability {
		if (app === "browser") {
			// Without real tabs (the web build) the Browser still shows the
			// servers the Terminal starts.
			const real = this.ports.browser.availability();
			if (real.available || !this.ports.embedded) return real;
			return this.ports.embedded.availability().available
				? { available: true }
				: real;
		}
		if (app === "files") return this.ports.files.availability();
		if (app === "tasks" || app === "visualize") return { available: true };
		return this.terminal.availability;
	}

	private requireApp(app: MemonAppId): void {
		if (!this.config.apps[app]) {
			throw new Error(
				`The ${app} app is turned off for this agent. Ask the user to enable it in MemonOS Bot settings.`,
			);
		}
		const availability = this.appAvailability(app);
		if (!availability.available) {
			throw new Error(
				`The ${app} app is not available here: ${availability.reason ?? "unsupported platform"}.`,
			);
		}
	}

	// ── Windows ─────────────────────────────────────────────────────────────

	// ── App kit: shared drafts and controls by ref ─────────────────────────

	/** A field's draft, shared by the user and the agent. */
	draft<T>(key: string, fallback: T): T {
		return this.drafts.has(key) ? (this.drafts.get(key) as T) : fallback;
	}

	setDraft(key: string, value: unknown): void {
		if (value === undefined) this.drafts.delete(key);
		else this.drafts.set(key, value);
		this.changed();
	}

	/** Forgets the drafts whose keys start with `prefix`, e.g. after saving. */
	clearDrafts(prefix: string): void {
		for (const key of [...this.drafts.keys()]) {
			if (key.startsWith(prefix)) this.drafts.delete(key);
		}
		this.changed();
	}

	/**
	 * Uses a control of a kit app by its ref, as the agent reads it on the
	 * screen: clicks a button, switches a toggle, types into a field or picks
	 * an option.
	 */
	async actOnControl(
		ref: string,
		action: "click" | "type" | "toggle" | "select",
		text?: string,
	): Promise<string> {
		const found = kitAppForRef(ref);
		if (!found) throw new Error(`${ref} is not a control of a computer app.`);
		const [appId, app] = found;
		const window = this.windowFor(appId);
		if (!window) {
			throw new Error(
				`The ${appId} window is not open; open it with memon_window first.`,
			);
		}
		const control = controlsByRef(app.view(this.snapshot()), app.refPrefix).get(
			ref,
		);
		if (!control) {
			throw new Error(
				`There is no ${ref} on the ${appId} window now. Call memon_screen and use the new refs.`,
			);
		}
		if ("disabled" in control && control.disabled) {
			throw new Error(`${control.label} is unavailable: ${control.disabled}.`);
		}
		this.focusWindow(window.id);
		let value: MemonControlValue;
		switch (control.type) {
			case "button":
				if (action !== "click")
					throw new Error(`${ref} is a button; click it.`);
				value = undefined;
				break;
			case "toggle":
				value =
					text === undefined ? !control.checked : /^(on|true|yes)$/i.test(text);
				break;
			case "input":
				if (action !== "type" || text === undefined) {
					throw new Error(`${ref} is a field; type into it with text.`);
				}
				value = text;
				break;
			case "select":
			case "tabs": {
				const wanted = (text ?? "").trim().toLowerCase();
				const option = control.options.find(
					(candidate) =>
						candidate.value.toLowerCase() === wanted ||
						candidate.label.toLowerCase() === wanted,
				);
				if (!option) {
					throw new Error(
						`${ref} takes one of: ${control.options.map((candidate) => candidate.value).join(", ")}.`,
					);
				}
				value = option.value;
				break;
			}
		}
		return app.act(this, control.id, value, { byUser: false });
	}

	private windowFor(app: MemonWindowApp): MemonWindowState | undefined {
		return this.windows.find((window) => window.app === app);
	}

	findWindow(idOrApp: string): MemonWindowState | undefined {
		return this.windows.find(
			(window) => window.id === idOrApp || window.app === idOrApp,
		);
	}

	openWindow(app: MemonWindowApp): MemonWindowState {
		const required = APP_OF_WINDOW[app];
		if (required) this.requireApp(required);
		if (app === "pi" && !this.config.piCode) {
			throw new Error(
				"pi code is turned off for this agent. The user can turn it on in MemonOS Bot settings.",
			);
		}
		let window = this.windowFor(app);
		if (!window) {
			this.windowSeq += 1;
			window = {
				id: `w${this.windowSeq}`,
				app,
				...DEFAULT_LAYOUT[app],
				z: ++this.zSeq,
				minimized: false,
				maximized: false,
			};
			this.windows.push(window);
			if (app === "files" && !this.unsubscribeFiles) {
				this.unsubscribeFiles = this.ports.files.subscribe(() =>
					this.scheduleFilesRefresh(),
				);
			}
		}
		// pi runs while its window is open. Opened by the user, the window
		// asks for a folder; the agent starts pi in the folder it names.
		if (app === "pi") this.piCode.choose();
		this.focusWindow(window.id);
		return window;
	}

	focusWindow(windowId: string): void {
		const window = this.windows.find((candidate) => candidate.id === windowId);
		if (!window) throw new Error(`No window ${windowId} on the screen.`);
		window.minimized = false;
		if (this.focusedWindowId !== windowId) window.z = ++this.zSeq;
		this.focusedWindowId = windowId;
		this.changed();
	}

	minimizeWindow(windowId: string): void {
		const window = this.windows.find((candidate) => candidate.id === windowId);
		if (!window) throw new Error(`No window ${windowId} on the screen.`);
		window.minimized = true;
		if (this.focusedWindowId === windowId)
			this.focusedWindowId = this.topWindowId();
		this.changed();
	}

	toggleMaximize(windowId: string): void {
		const window = this.windows.find((candidate) => candidate.id === windowId);
		if (!window) throw new Error(`No window ${windowId} on the screen.`);
		window.maximized = !window.maximized;
		this.focusWindow(windowId);
	}

	moveWindow(
		windowId: string,
		rect: Partial<Pick<MemonWindowState, "x" | "y" | "w" | "h">>,
	): void {
		const window = this.windows.find((candidate) => candidate.id === windowId);
		if (!window) return;
		const clamp = (value: number, min: number, max: number) =>
			Math.min(max, Math.max(min, value));
		if (rect.w !== undefined) window.w = clamp(rect.w, 0.2, 1);
		if (rect.h !== undefined) window.h = clamp(rect.h, 0.18, 1);
		if (rect.x !== undefined) window.x = clamp(rect.x, -window.w + 0.12, 0.94);
		if (rect.y !== undefined) window.y = clamp(rect.y, 0, 0.92);
		this.changed();
	}

	async closeWindow(windowId: string): Promise<void> {
		const window = this.windows.find((candidate) => candidate.id === windowId);
		if (!window) return;
		if (window.app === "browser") {
			for (const tab of this.tabs) await this.releaseTab(tab);
			this.tabs = [];
			this.activeTabId = null;
			this.browserWindowId = undefined;
		}
		if (window.app === "files") {
			this.unsubscribeFiles?.();
			this.unsubscribeFiles = undefined;
		}
		if (window.app === "editor") this.unwatchEditorFile();
		// Closing pi's window quits pi, like closing an app.
		if (window.app === "pi") await this.piCode.stop();
		this.windows = this.windows.filter((candidate) => candidate !== window);
		if (this.focusedWindowId === windowId)
			this.focusedWindowId = this.topWindowId();
		this.changed();
	}

	private topWindowId(): string | null {
		const visible = this.windows.filter((window) => !window.minimized);
		visible.sort((a, b) => b.z - a.z);
		return visible[0]?.id ?? null;
	}

	// ── pi code ─────────────────────────────────────────────────────────────

	/**
	 * Opens pi code in a folder (`~` is the home): the user's pick in its
	 * window, or `picode` in the Terminal. `continueLast` opens the folder's
	 * last session; `create` a new folder, which pi makes as it starts.
	 */
	async openPiCode(
		path: string,
		options: { continueLast?: boolean; create?: boolean } = {},
	): Promise<PiCodeOpened> {
		if (!this.config.piCode) {
			throw new Error(
				"pi code is turned off for this agent. The user can turn it on in MemonOS Bot settings.",
			);
		}
		const cwd = this.resolvePath(path, this.home);
		const shown = memonDisplayPath(cwd, this.home);
		const isFolder = (folder: string) =>
			this.ports.files.isDirectory(folder).catch(() => false);
		if (options.create) {
			if (await this.ports.files.exists(cwd).catch(() => false)) {
				throw new Error(`${shown} is already there.`);
			}
			const parent = cwd.replace(/\/[^/]*$/, "") || "/";
			if (!(await isFolder(parent))) {
				throw new Error(
					`${memonDisplayPath(parent, this.home)} is not a folder.`,
				);
			}
		} else if (!(await isFolder(cwd))) {
			throw new Error(`${shown} is not a folder.`);
		}
		return this.piCode.open(cwd, options);
	}

	/** The folders in a folder (the home by default), for pi's folder picker. */
	async browseFolders(path = "~"): Promise<MemonPiCodeBrowse> {
		const dir = this.resolvePath(path, this.home);
		if (!(await this.ports.files.isDirectory(dir).catch(() => false))) {
			throw new Error(`${memonDisplayPath(dir, this.home)} is not a folder.`);
		}
		const entries = await this.ports.files.list(dir);
		return {
			dir,
			parent: dir === "/" ? undefined : dir.replace(/\/[^/]*$/, "") || "/",
			folders: entries
				.filter((entry) => entry.type === "dir")
				.map(({ name, path: folder }) => ({ name, path: folder })),
			files: entries
				.filter((entry) => entry.type === "file")
				.map((entry) => entry.name),
		};
	}

	// ── Browser ─────────────────────────────────────────────────────────────

	private activeTab(): MemonBrowserTab | undefined {
		return this.tabs.find((tab) => tab.id === this.activeTabId);
	}

	/** Real tabs go through the browser; embedded ones through the sandbox. */
	private browserPort(tab: MemonBrowserTab): MemonBrowserPort {
		if (tab.kind !== "embedded") return this.ports.browser;
		if (!this.ports.embedded) {
			throw new Error("Embedded pages are not available on this computer.");
		}
		return this.ports.embedded;
	}

	private requireActiveTab(): MemonBrowserTab {
		const tab = this.activeTab();
		if (!tab) throw new Error("No page is open. Use memon_open with a url.");
		return tab;
	}

	/** A picture of an element of the page in front (a ref of the latest screen). */
	async captureRef(ref: string): Promise<MemonPageCapture> {
		this.requireApp("browser");
		const tab = this.requireActiveTab();
		const port = this.browserPort(tab);
		if (!port.capture) {
			throw new Error("Pictures of pages are not available on this computer.");
		}
		return port.capture(tab.sessionId, {
			ref,
			docToken: tab.outline?.docToken,
		});
	}

	/** The chat's model can look at pictures, so a picture goes to it. */
	async modelAcceptsImages(): Promise<boolean> {
		return (
			(await this.ports.models?.acceptsImages().catch(() => false)) ?? false
		);
	}

	/** Saves a picture (a PNG data URL) into ~/Pictures; returns its path. */
	async savePicture(dataUrl: string, name: string): Promise<string> {
		this.requireApp("files");
		const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const path = await this.freeName(
			this.resolvePath(MEMON_PICTURES_DIR),
			`${name}.png`,
			"move",
		);
		await this.ports.files.write(path, bytes);
		await this.refreshFiles().catch(() => undefined);
		return path;
	}

	private async releaseTab(tab: MemonBrowserTab): Promise<void> {
		this.releases.get(tab.sessionId)?.();
		this.releases.delete(tab.sessionId);
		await this.browserPort(tab)
			.close(tab.sessionId)
			.catch(() => undefined);
	}

	/** Records the tab's current page as a new history entry if it moved. */
	private recordVisit(tab: MemonBrowserTab, url: string): void {
		const same = (a?: string, b?: string) =>
			(a ?? "").replace(/[#/]+$/, "") === (b ?? "").replace(/[#/]+$/, "");
		if (same(tab.history[tab.historyIndex], url)) return;
		tab.history = [...tab.history.slice(0, tab.historyIndex + 1), url];
		tab.historyIndex = tab.history.length - 1;
	}

	/**
	 * Syncs the tab from its page: address, title, history and outline.
	 * `settleMs` waits up to that long for the page to hold still first.
	 */
	private async readTab(tab: MemonBrowserTab, settleMs = 0): Promise<void> {
		try {
			const port = this.browserPort(tab);
			const outline =
				settleMs > 0 && port.settle
					? await port.settle(tab.sessionId, { timeoutMs: settleMs })
					: await port.outline(tab.sessionId);
			tab.outline = outline;
			tab.url = outline.url || tab.url;
			tab.title = outline.title || tab.title;
			tab.error = undefined;
			this.recordVisit(tab, tab.url);
		} catch (error) {
			tab.error = error instanceof Error ? error.message : String(error);
		}
		this.changed();
	}

	/**
	 * Whether a page opens embedded: the sandbox's own preview URLs, and a
	 * local address the computer serves. Any other local address is a server
	 * on the user's machine, which only a real tab reaches; where there are
	 * no real tabs (the web build), embedded is all there is.
	 */
	private async opensEmbedded(url: string): Promise<boolean> {
		const target = this.ports.embedded ? sandboxTargetOf(url) : null;
		if (!target) return false;
		if (!isLoopbackUrl(url)) return true;
		if (!this.ports.browser.availability().available) return true;
		// A command still starting its server gets a moment to listen.
		const deadline =
			Date.now() + (this.terminal.running ? SERVER_START_WAIT_MS : 0);
		while (true) {
			const servers = await this.terminal
				.checkServers()
				.catch(() => this.terminal.servers);
			if (servers.includes(target.port)) return true;
			if (Date.now() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	/**
	 * Opens a URL in the active tab, or in a new one. A local address the
	 * computer serves (localhost:3000) opens embedded, where its servers are;
	 * `embedded` asks for one kind or the other.
	 */
	async openUrl(
		input: string,
		options: { newTab?: boolean; embedded?: boolean } = {},
	): Promise<void> {
		this.requireApp("browser");
		const window = this.openWindow("browser");
		const url = normalizeBrowserUrl(input);
		const embedded = options.embedded ?? (await this.opensEmbedded(url));
		if (embedded && !this.ports.embedded) {
			throw new Error("Embedded pages are not available on this computer.");
		}
		if (!embedded) {
			const real = this.ports.browser.availability();
			if (!real.available) {
				throw new Error(
					`Real pages cannot open here (${real.reason ?? "no browser"}). The Browser shows servers started in the Terminal, like http://localhost:3000.`,
				);
			}
		}
		const port: MemonBrowserPort = embedded
			? (this.ports.embedded as MemonEmbeddedPort)
			: this.ports.browser;
		const current = this.activeTab();
		// A page of the other kind opens in a tab of its own.
		if (
			current &&
			!options.newTab &&
			(current.kind === "embedded") === embedded
		) {
			const page = await port.navigate(current.sessionId, url);
			current.url = page.url;
			current.title = page.title;
			current.outline = null;
			await this.readTab(current, PAGE_OPEN_SETTLE_MS);
			this.focusWindow(window.id);
			return;
		}
		const opened = await port.open(url, {
			windowId: embedded ? undefined : this.browserWindowId,
		});
		if (!embedded) this.browserWindowId ??= opened.windowId;
		this.releases.set(opened.sessionId, port.reserve(opened.sessionId));
		this.tabSeq += 1;
		const tab: MemonBrowserTab = {
			id: `tab${this.tabSeq}`,
			sessionId: opened.sessionId,
			...(embedded ? { kind: "embedded" as const } : {}),
			url: opened.url,
			title: opened.title,
			outline: null,
			history: [opened.url],
			historyIndex: 0,
		};
		this.tabs.push(tab);
		this.activeTabId = tab.id;
		await this.readTab(tab, PAGE_OPEN_SETTLE_MS);
		this.focusWindow(window.id);
	}

	async browserAction(
		request: Omit<WebOutlineActionRequest, "docToken" | "allowFormSubmit">,
		options: { byUser?: boolean } = {},
	): Promise<WebOutlineActionResult> {
		this.requireApp("browser");
		const tab = this.requireActiveTab();
		const allowFormSubmit = options.byUser || !this.config.askBefore.forms;
		const { result, outline } = await this.browserPort(tab).act(tab.sessionId, {
			...request,
			// The user acts on what they see; the agent must act on what it read.
			docToken: options.byUser ? undefined : tab.outline?.docToken,
			allowFormSubmit,
		});
		if (!result.ok) {
			throw new MemonApprovalRequiredError(
				"forms",
				`${result.detail} Ask the user before submitting it, or have them take over and submit it themselves.`,
			);
		}
		if (outline) {
			tab.outline = outline;
			tab.url = outline.url || tab.url;
			tab.title = outline.title || tab.title;
		}
		// A click or a key can start a navigation that replaces the document
		// after the outline was taken; read again once it settles.
		if (
			!outline ||
			request.action === "click" ||
			request.action === "submit" ||
			request.action === "press" ||
			request.action === "toggle"
		) {
			await new Promise((resolve) => setTimeout(resolve, 400));
			await this.readTab(tab);
		} else {
			this.changed();
		}
		return result;
	}

	async browserHistory(direction: WebHistoryDirection): Promise<void> {
		this.requireApp("browser");
		const tab = this.requireActiveTab();
		const targetIndex = tab.historyIndex + (direction === "back" ? -1 : 1);
		const target = tab.history[targetIndex];
		if (target) {
			// Navigate to the tab's own entry: the browser's history skips pages
			// reached without a user gesture, which is every page the agent opened.
			tab.historyIndex = targetIndex;
			await this.browserPort(tab).navigate(tab.sessionId, target);
		} else {
			await this.browserPort(tab).history(tab.sessionId, direction);
		}
		await this.readTab(tab, PAGE_OPEN_SETTLE_MS);
	}

	/**
	 * Syncs the front tab again from its page, which may have moved since it
	 * was read: the user worked in the real tab, or its scripts drew more.
	 */
	async refreshBrowser(): Promise<void> {
		const tab = this.activeTab();
		if (tab) await this.readTab(tab, PAGE_READ_SETTLE_MS);
	}

	async selectTab(index: number): Promise<void> {
		const tab = this.tabs[index - 1];
		if (!tab) throw new Error(`There is no tab ${index}.`);
		this.activeTabId = tab.id;
		const window = this.windowFor("browser");
		if (window) this.focusWindow(window.id);
		await this.readTab(tab);
	}

	async closeTab(index: number): Promise<void> {
		const tab = this.tabs[index - 1];
		if (!tab) throw new Error(`There is no tab ${index}.`);
		await this.releaseTab(tab);
		this.tabs = this.tabs.filter((candidate) => candidate !== tab);
		if (this.activeTabId === tab.id) {
			this.activeTabId = this.tabs[Math.max(0, index - 2)]?.id ?? null;
		}
		if (!this.tabs.length) this.browserWindowId = undefined;
		this.changed();
	}

	// ── Files and editor ────────────────────────────────────────────────────

	/**
	 * Creates Bot.md and Memory.md the first time, moves an older version's
	 * notes and history to their hidden files, reads the tasks and the
	 * command history, and keeps the desktop (the home's files) and both apps
	 * current, whichever app (or the Files page) changes the files.
	 */
	async prepareDesktop(): Promise<void> {
		const home = this.homeDir;
		await migrateMemonHomeFiles(this.ports.files, home);
		await loadMemonDesktopFiles(this.ports.files, home);
		if (home !== this.homeDir) return;
		await Promise.all([this.loadTasks(), this.loadHistory()]);
		await this.refreshDesktop();
		this.unsubscribeDesktop ??= this.ports.files.subscribe(() => {
			if (this.desktopRefreshTimer) clearTimeout(this.desktopRefreshTimer);
			this.desktopRefreshTimer = setTimeout(() => {
				this.desktopRefreshTimer = undefined;
				void this.refreshDesktop();
				void this.loadTasks();
				void this.loadHistory();
			}, 300);
		});
	}

	/** The agent using the computer, if any. */
	get agent(): string | null {
		return this.agentId;
	}

	/**
	 * Moves the computer to another home. `follow`: the same agent's home was
	 * moved (a rename), so what is open moves with it; otherwise the home is
	 * another agent's, with its own tasks and history.
	 */
	setHome(home: string, follow = true): void {
		if (home === this.homeDir) return;
		const previous = this.homeDir;
		if (follow) {
			this.followMove(previous, home);
		} else {
			if (
				this.filesCwd === previous ||
				this.filesCwd.startsWith(`${previous}/`)
			)
				this.filesCwd = home;
			this.tasksPath = null;
		}
		this.homeDir = home;
		this.terminal.changeHome(previous, home, follow);
		this.changed();
		if (this.unsubscribeDesktop) {
			void this.prepareDesktop().catch(() => undefined);
		}
	}

	/** Asks where the agent's home is now, e.g. after a rename. */
	async refreshHome(follow = true): Promise<string> {
		const homes = this.ports.homes;
		if (!homes) return this.homeDir;
		const agentId = this.agentId;
		const home = await homes.resolve(agentId);
		if (agentId === this.agentId) this.setHome(home, follow);
		return this.homeDir;
	}

	private get tasksFile(): string {
		return this.tasksPath ?? memonHomePaths(this.homeDir).tasks;
	}

	private get historyFile(): string {
		return memonHomePaths(this.homeDir).terminalHistory;
	}

	/** Keeps the tasks in their file, ~/.tasks unless another is open. */
	private saveTasks(): void {
		this.tasksError = undefined;
		this.tasksSync.save(
			this.tasksFile,
			serializeTasksFile({ tasks: this.taskItems }),
		);
	}

	/**
	 * Reads the tasks from their file when it changed. A file that is not
	 * tasks leaves them as they are, with the reason shown.
	 */
	private async loadTasks(): Promise<void> {
		const path = this.tasksFile;
		const read = await this.tasksSync.read(path);
		if (path !== this.tasksFile || read.status === "same") return;
		if (read.status === "missing") {
			if (!this.taskItems.length && !this.tasksError) return;
			this.taskItems = [];
			this.tasksError = undefined;
		} else {
			try {
				this.taskItems = parseTasksFile(read.content).tasks;
				this.tasksError = undefined;
			} catch (error) {
				this.tasksError = `${memonDisplayPath(path, this.homeDir)} is not tasks: ${error instanceof Error ? error.message : String(error)}. The next change writes it again.`;
			}
		}
		this.changed();
	}

	/** Reads the command history from its file when it changed. */
	private async loadHistory(): Promise<void> {
		const path = this.historyFile;
		const read = await this.historySync.read(path);
		if (path !== this.historyFile || read.status === "same") return;
		if (read.status === "missing") {
			if (this.terminal.history.length) this.terminal.setHistory([]);
			return;
		}
		try {
			this.terminal.setHistory(parseTerminalHistory(read.content));
		} catch {
			// Not a history: the Terminal keeps its own, and writes it again.
		}
	}

	/** Opens a `.tasks` file in Tasks; its tasks replace the open ones. */
	async openTasksFile(path: string): Promise<void> {
		this.requireApp("tasks");
		const target = this.resolvePath(path);
		const isDefault = target === memonHomePaths(this.homeDir).tasks;
		if (!isDefault && !(await this.ports.files.exists(target))) {
			throw new Error(`Could not open ${target}: there is no such file.`);
		}
		await this.tasksSync.flush();
		this.tasksPath = isDefault ? null : target;
		await this.loadTasks();
		this.focusWindow(this.openWindow("tasks").id);
	}

	/**
	 * Runs a `.terminal` launcher: its command, in a Terminal tab of its own.
	 * The user's click runs it; the agent's waits for approval like any of
	 * its commands. Returns the tab, or null when the file is no launcher.
	 */
	async launchTerminalFile(
		path: string,
		options: { byUser?: boolean; waitMs?: number } = {},
	): Promise<{ tabId: string; command: string } | null> {
		this.requireApp("terminal");
		const target = this.resolvePath(path);
		let content: string;
		try {
			content = await this.ports.files.read(target);
		} catch (error) {
			throw new Error(
				`Could not open ${target}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		const launcher = parseTerminalLauncher(content);
		if (!launcher) return null;
		this.focusWindow(this.openWindow("terminal").id);
		const { tabId } = await this.terminal.launch(launcher.command, {
			cwd: launcher.cwd,
			byUser: options.byUser,
			waitMs: options.waitMs,
		});
		return { tabId, command: launcher.command };
	}

	/**
	 * Keeps a command as a `.terminal` launcher (in the home unless `name` is
	 * a path), so a click on the desktop runs it again in a new tab. `cwd` is
	 * where it runs (default: the Terminal tab's directory), kept with `~` so
	 * the launcher moves with the home.
	 */
	async saveTerminalLauncher(
		name: string,
		command: string,
		cwd?: string,
	): Promise<string> {
		this.requireApp("terminal");
		if (!command.trim()) throw new Error("A launcher needs a command.");
		const path = this.appFilePath(name, MEMON_TERMINAL_EXTENSION);
		const dir = this.resolvePath(
			cwd?.trim() || ".",
			this.terminal.snapshot().cwd,
		);
		await this.ports.files.write(
			path,
			serializeTerminalLauncher({
				command: command.trim(),
				cwd:
					dir === this.homeDir
						? undefined
						: memonDisplayPath(dir, this.homeDir),
			}),
		);
		await this.refreshDesktop();
		return path;
	}

	/**
	 * Where an app file goes: a bare name is a file in the home, a path is
	 * where it says; the extension is added when missing.
	 */
	private appFilePath(name: string, extension: string): string {
		const trimmed = name.trim();
		if (!trimmed) throw new Error("Give the file a name.");
		const path =
			trimmed.includes("/") || trimmed.startsWith("~")
				? this.resolvePath(trimmed)
				: `${this.homeDir}/${trimmed.replace(/[\\:*?"<>|]+/g, " ").trim()}`;
		return path.toLowerCase().endsWith(extension)
			? path
			: `${path}${extension}`;
	}

	/** Forgets the Terminal's command history, in its file too. */
	clearTerminalHistory(): void {
		this.terminal.clearHistory();
	}

	/**
	 * Lists or changes one entry of Memory.md or Bot.md. Works without the
	 * Files app: these two files are the bot's own, not the user's documents.
	 */
	async editDesktopFile(
		file: "memory" | "bot",
		change: MemonDesktopEntryChange,
	): Promise<{ path: string; entries: string[]; length: number }> {
		const paths = memonHomePaths(this.home);
		const path = file === "bot" ? paths.bot : paths.memory;
		const template =
			file === "bot" ? MEMON_BOT_TEMPLATE : MEMON_MEMORY_TEMPLATE;
		let content: string;
		try {
			content = await this.ports.files.read(path);
		} catch {
			content = template;
		}
		const next = changeDesktopEntries(content, change);
		if (next !== content) {
			await this.ports.files.write(path, next);
			// Show it in an open Editor, unless the user has unsaved edits there.
			if (this.editorPath === path && this.editorSaved) {
				this.editorContent = next;
				this.editorBase = next;
			}
			this.changed();
		}
		return { path, entries: listDesktopEntries(next), length: next.length };
	}

	/** The desktop shows the home's files; hidden ones stay hidden. */
	async refreshDesktop(): Promise<void> {
		try {
			this.desktopEntries = (await this.ports.files.list(this.home)).filter(
				(entry) => !entry.name.startsWith("."),
			);
		} catch {
			this.desktopEntries = [];
		}
		this.changed();
	}

	private scheduleFilesRefresh(): void {
		if (this.filesRefreshTimer) clearTimeout(this.filesRefreshTimer);
		this.filesRefreshTimer = setTimeout(() => {
			this.filesRefreshTimer = undefined;
			void this.refreshFiles();
		}, 150);
	}

	async refreshFiles(): Promise<void> {
		try {
			this.fileEntries = await this.ports.files.list(this.filesCwd);
			this.filesError = undefined;
		} catch (error) {
			this.filesError = error instanceof Error ? error.message : String(error);
		}
		this.changed();
	}

	/** This agent's home folder, shown as `~`. */
	get home(): string {
		return this.homeDir;
	}

	/** A Files path: `~` is the home, relative paths start at the open folder. */
	resolvePath(path: string, cwd = this.filesCwd): string {
		const trimmed = path.trim();
		if (trimmed === "~" || trimmed.startsWith("~/")) {
			return normalizePath(`${this.home}${trimmed.slice(1)}`);
		}
		return normalizePath(trimmed, cwd);
	}

	isFolder(path: string): Promise<boolean> {
		return this.ports.files.isDirectory(this.resolvePath(path));
	}

	async openFolder(path: string): Promise<void> {
		this.requireApp("files");
		const window = this.openWindow("files");
		const target = this.resolvePath(path);
		if (!(await this.ports.files.isDirectory(target))) {
			throw new Error(`${target} is not a folder.`);
		}
		this.filesCwd = target;
		await this.refreshFiles();
		this.focusWindow(window.id);
	}

	async openFile(
		path: string,
		options: { create?: boolean; byUser?: boolean; asText?: boolean } = {},
	): Promise<void> {
		const target = this.resolvePath(path);
		// Like a desktop's file types: a .tasks file opens in Tasks, a
		// .terminal launcher runs in the Terminal and a .studio app opens in
		// Studio, when the agent has them; else it is JSON text, for the Editor.
		// `asText` opens them in the Editor, to read or change what they hold
		// (a launcher's command) without running them.
		const asApp = !options.asText;
		if (
			asApp &&
			target.endsWith(MEMON_TASKS_EXTENSION) &&
			this.config.apps.tasks
		) {
			return this.openTasksFile(target);
		}
		if (asApp && target.endsWith(MEMON_STUDIO_EXTENSION)) {
			await this.openStudioApp(target);
			return;
		}
		if (
			asApp &&
			target.endsWith(MEMON_TERMINAL_EXTENSION) &&
			this.config.apps.terminal &&
			this.terminal.availability.available &&
			(await this.launchTerminalFile(target, { byUser: options.byUser }))
		) {
			return;
		}
		this.requireApp("files");
		// A visual opens drawn, in Visualize, when the agent has it.
		if (target.endsWith(MEMON_VISUAL_EXTENSION) && this.config.apps.visualize) {
			return this.openVisual(target);
		}
		// PDFs, images, media and spreadsheets always open in the Viewer; the
		// Editor would show their bytes as noise.
		const kind = memonFileKind(target);
		if (kind !== "text") return this.openViewer(target, kind);
		let content = "";
		let saved = true;
		try {
			content = await this.ports.files.read(target);
		} catch (error) {
			if (!options.create) {
				throw new Error(
					`Could not open ${target}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			saved = false;
		}
		this.editorPath = target;
		this.editorContent = content;
		this.editorSaved = saved;
		this.editorBase = saved ? content : null;
		this.editorConflict = null;
		this.editorScreenLine = 0;
		const window = this.openWindow("editor");
		this.watchEditorFile();
		this.focusWindow(window.id);
	}

	/**
	 * The agent or another window may write the open file. Follow it while the
	 * Editor has no unsaved edits; otherwise remember it, so a save does not
	 * silently replace it.
	 */
	private watchEditorFile(): void {
		if (this.unsubscribeEditorFile) return;
		this.unsubscribeEditorFile = this.ports.files.subscribe(() => {
			if (this.editorRefreshTimer) clearTimeout(this.editorRefreshTimer);
			this.editorRefreshTimer = setTimeout(() => {
				this.editorRefreshTimer = undefined;
				void this.refreshEditorFromDisk();
			}, 150);
		});
	}

	private unwatchEditorFile(): void {
		this.unsubscribeEditorFile?.();
		this.unsubscribeEditorFile = undefined;
		if (this.editorRefreshTimer) clearTimeout(this.editorRefreshTimer);
		this.editorRefreshTimer = undefined;
	}

	private async readEditorFile(path: string): Promise<string | null> {
		try {
			return await this.ports.files.read(path);
		} catch {
			return null;
		}
	}

	private async refreshEditorFromDisk(): Promise<void> {
		const path = this.editorPath;
		if (!path || this.disposed) return;
		const disk = await this.readEditorFile(path);
		// Gone, or another file opened meanwhile.
		if (disk === null || path !== this.editorPath) return;
		const before = [this.editorContent, this.editorSaved, this.editorConflict];
		if (disk === this.editorBase) {
			this.editorConflict = null;
		} else if (disk === this.editorContent) {
			// The unsaved content landed on disk (a save, or the same edit).
			this.editorBase = disk;
			this.editorSaved = true;
			this.editorConflict = null;
		} else if (this.editorSaved) {
			this.editorContent = disk;
			this.editorBase = disk;
		} else {
			this.editorConflict = disk;
		}
		const after = [this.editorContent, this.editorSaved, this.editorConflict];
		if (after.some((value, index) => value !== before[index])) this.changed();
	}

	/**
	 * Shows a PDF, image, media file or spreadsheet. The user sees the real
	 * preview; the agent reads the text the files port extracts.
	 */
	private async openViewer(path: string, kind: MemonViewerKind): Promise<void> {
		this.viewerPath = path;
		this.viewerKind = kind;
		this.viewerText = "";
		this.viewerSize = undefined;
		this.viewerError = undefined;
		this.viewerScreenLine = 0;
		this.viewerLoading = true;
		const window = this.openWindow("viewer");
		this.focusWindow(window.id);
		try {
			const preview = await this.ports.files.preview(path, kind);
			if (this.viewerPath !== path) return;
			this.viewerText =
				preview.text.length > MAX_VIEWER_TEXT_CHARS
					? `${preview.text.slice(0, MAX_VIEWER_TEXT_CHARS)}\n… (the rest of the file is cut off)`
					: preview.text;
			this.viewerSize = preview.size;
		} catch (error) {
			if (this.viewerPath !== path) return;
			this.viewerError = `Could not open ${path}: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			if (this.viewerPath === path) {
				this.viewerLoading = false;
				this.changed();
			}
		}
	}

	/** The focused window when it shows paged text (Editor or Viewer). */
	focusedTextWindow(): "editor" | "viewer" | "visualize" | null {
		const app = this.windows.find(
			(window) => window.id === this.focusedWindowId && !window.minimized,
		)?.app;
		return app === "editor" || app === "viewer" || app === "visualize"
			? app
			: null;
	}

	/** Pages the agent's view of the Editor or Viewer text. */
	scrollText(
		app: "editor" | "viewer" | "visualize",
		direction: "up" | "down",
	): void {
		const text =
			app === "editor"
				? this.editorContent
				: app === "visualize"
					? this.visualSource
					: this.viewerText;
		const lastPage = Math.max(
			0,
			text.split("\n").length - MEMON_TEXT_PAGE_LINES,
		);
		const current =
			app === "editor"
				? this.editorScreenLine
				: app === "visualize"
					? this.visualScreenLine
					: this.viewerScreenLine;
		const next = Math.min(
			lastPage,
			Math.max(
				0,
				current +
					(direction === "down"
						? MEMON_TEXT_PAGE_LINES
						: -MEMON_TEXT_PAGE_LINES),
			),
		);
		if (app === "editor") this.editorScreenLine = next;
		else if (app === "visualize") this.visualScreenLine = next;
		else this.viewerScreenLine = next;
		this.changed();
	}

	/** The path an `f` ref of the Files window names. */
	fileRefPath(ref: string): string {
		const match = listFileRefs({
			cwd: this.filesCwd,
			entries: this.fileEntries,
		}).find((candidate) => candidate.ref === ref);
		if (!match || match.target.kind === "new-file") {
			throw new Error(
				`${ref} is not a file or folder in the Files window. Read the screen again.`,
			);
		}
		return match.target.kind === "up"
			? match.target.path
			: match.target.entry.path;
	}

	/**
	 * A name nothing in `dir` has yet: the name itself, else "a copy.md",
	 * "a copy 2.md" for copies and "a 2.md", "a 3.md" for moves.
	 */
	private async freeName(
		dir: string,
		name: string,
		as: "copy" | "move",
	): Promise<string> {
		const dot = name.lastIndexOf(".");
		const [stem, ext] =
			dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
		for (let n = 1; n < 1000; n++) {
			const candidate =
				n === 1 && as === "move"
					? name
					: as === "copy"
						? `${stem} copy${n === 1 ? "" : ` ${n}`}${ext}`
						: `${stem} ${n}${ext}`;
			const path = normalizePath(candidate, dir);
			if (!(await this.ports.files.exists(path))) return path;
		}
		throw new Error(`${dir} has too many entries named like ${name}.`);
	}

	/**
	 * Saves a file from the web into Files (an image, a font, a PDF) in one
	 * step. `to` is a folder (the file keeps its name) or a file path;
	 * ~/Downloads by default. Nothing is overwritten.
	 */
	async downloadFile(
		url: string,
		to?: string,
	): Promise<{ path: string; size: number; type: string }> {
		this.requireApp("files");
		const download = this.ports.download;
		if (!download) {
			throw new Error("Downloads are not available on this computer.");
		}
		const source = url.trim();
		if (source.startsWith("data:")) {
			throw new Error(
				"That image is inline in the page, not a file to download.",
			);
		}
		if (!/^https?:\/\//i.test(source)) {
			throw new Error(
				`Give a full http(s) address to download, not "${source}".`,
			);
		}
		if (sandboxTargetOf(source)) {
			throw new Error(
				`${source} is a server in this computer: its files are already in Files (copy them), or save one with curl -o in the Terminal.`,
			);
		}
		const fetched = await download.fetch(source);
		const name = downloadFileName(fetched.url, fetched.contentType);
		const wanted = this.resolvePath(to?.trim() || MEMON_DOWNLOADS_DIR);
		const intoFolder =
			!to?.trim() ||
			/\/$/.test(to.trim()) ||
			(await this.ports.files.isDirectory(wanted).catch(() => false));
		const path = intoFolder
			? await this.freeName(wanted, name, "move")
			: await this.freeName(
					wanted.replace(/\/[^/]*$/, "") || "/",
					wanted.slice(wanted.lastIndexOf("/") + 1),
					"move",
				);
		await this.ports.files.write(path, fetched.bytes);
		await this.refreshFiles().catch(() => undefined);
		return {
			path,
			size: fetched.bytes.byteLength,
			type: fetched.contentType.split(";")[0]?.trim() ?? "",
		};
	}

	/**
	 * Zips a folder into Files (~/Downloads by default; `to` is a folder or a
	 * file path) and hands it to the user: the Computer panel downloads it to
	 * their machine. Nothing is overwritten.
	 */
	async exportFolderZip(
		folder: string,
		to?: string,
	): Promise<{ path: string; size: number; fileCount: number }> {
		this.requireApp("files");
		const source = this.resolvePath(folder);
		if (!(await this.ports.files.isDirectory(source).catch(() => false))) {
			throw new Error(`${folder} is not a folder: zip takes a folder.`);
		}
		const zip = await this.ports.files.zip(source);
		const wanted = this.resolvePath(to?.trim() || MEMON_DOWNLOADS_DIR);
		const intoFolder =
			!to?.trim() ||
			/\/$/.test(to.trim()) ||
			(await this.ports.files.isDirectory(wanted).catch(() => false));
		const path = intoFolder
			? await this.freeName(wanted, zip.name, "move")
			: await this.freeName(
					wanted.replace(/\/[^/]*$/, "") || "/",
					wanted.slice(wanted.lastIndexOf("/") + 1),
					"move",
				);
		await this.ports.files.write(path, zip.bytes);
		this.fileExport = {
			id: (this.fileExport?.id ?? 0) + 1,
			path,
			name: path.slice(path.lastIndexOf("/") + 1),
			at: Date.now(),
		};
		await this.refreshFiles().catch(() => this.changed());
		return { path, size: zip.bytes.byteLength, fileCount: zip.fileCount };
	}

	/** Checks the sources and the folder they go to. */
	private async fileTransfer(
		paths: readonly string[],
		to: string,
		verb: "move" | "copy",
	): Promise<{ dest: string; sources: string[] }> {
		this.requireApp("files");
		const dest = this.resolvePath(to);
		if (!(await this.ports.files.isDirectory(dest))) {
			throw new Error(`${dest} is not a folder.`);
		}
		const sources = [...new Set(paths.map((path) => this.resolvePath(path)))];
		if (!sources.length) throw new Error(`Choose what to ${verb} first.`);
		for (const source of sources) {
			if (source === "/")
				throw new Error(`The root folder cannot be ${verb}d.`);
			if (dest === source || dest.startsWith(`${source}/`)) {
				throw new Error(`${source} cannot be ${verb}d into itself.`);
			}
			if (!(await this.ports.files.exists(source))) {
				throw new Error(`${source} does not exist any more.`);
			}
		}
		return { dest, sources };
	}

	/** Paths under `from` now live under `to`: open files follow them. */
	private followMove(from: string, to: string): void {
		const moved = (path: string | null): string | null =>
			path === from
				? to
				: path?.startsWith(`${from}/`)
					? `${to}${path.slice(from.length)}`
					: path;
		this.editorPath = moved(this.editorPath);
		this.viewerPath = moved(this.viewerPath);
		this.visualPath = moved(this.visualPath);
		this.tasksPath = moved(this.tasksPath);
		if (this.studioAppFile) {
			this.studioAppFile.path =
				moved(this.studioAppFile.path) ?? this.studioAppFile.path;
		}
		const cwd = moved(this.filesCwd);
		if (cwd) this.filesCwd = cwd;
	}

	/** Moves files and folders into a folder. Returns where they went. */
	async moveFiles(paths: readonly string[], to: string): Promise<string[]> {
		const { dest, sources } = await this.fileTransfer(paths, to, "move");
		const placed: string[] = [];
		for (const source of sources) {
			if (parentOf(source) === dest) {
				placed.push(source);
				continue;
			}
			const name = source.split("/").pop() ?? source;
			const target = await this.freeName(dest, name, "move");
			await this.ports.files.move(source, target);
			this.followMove(source, target);
			placed.push(target);
		}
		await this.refreshFiles();
		return placed;
	}

	/** Copies files and folders into a folder. Returns the copies. */
	async copyFiles(paths: readonly string[], to: string): Promise<string[]> {
		const { dest, sources } = await this.fileTransfer(paths, to, "copy");
		const placed: string[] = [];
		for (const source of sources) {
			const name = source.split("/").pop() ?? source;
			const target = await this.freeName(dest, name, "copy");
			await this.ports.files.copy(source, target);
			placed.push(target);
		}
		await this.refreshFiles();
		return placed;
	}

	/**
	 * Deletes files and folders, with everything in them. There is no trash:
	 * the user confirms first. Returns the paths deleted.
	 */
	async deleteFiles(paths: readonly string[]): Promise<string[]> {
		this.requireApp("files");
		const targets = [...new Set(paths.map((path) => this.resolvePath(path)))];
		for (const target of targets) {
			if (target === "/" || target === this.home) {
				throw new Error(`${target} cannot be deleted.`);
			}
		}
		const gone = (path: string, target: string) =>
			path === target || path.startsWith(`${target}/`);
		for (const target of targets) {
			await this.ports.files.remove(target);
			if (gone(this.filesCwd, target)) this.filesCwd = parentOf(target);
			if (this.fileClipboard) {
				const kept = this.fileClipboard.paths.filter(
					(path) => !gone(path, target),
				);
				this.fileClipboard = kept.length
					? { ...this.fileClipboard, paths: kept }
					: null;
			}
		}
		await this.refreshFiles();
		return targets;
	}

	/** Cuts or copies entries; a paste moves or copies them. */
	setFileClipboard(mode: "copy" | "cut", paths: readonly string[]): void {
		this.requireApp("files");
		const resolved = paths.map((path) => this.resolvePath(path));
		this.fileClipboard = resolved.length ? { mode, paths: resolved } : null;
		this.changed();
	}

	/** Pastes the clipboard into a folder (the open one by default). */
	async pasteFiles(
		to?: string,
	): Promise<{ mode: "copy" | "cut"; placed: string[] }> {
		const clipboard = this.fileClipboard;
		if (!clipboard) throw new Error("Nothing is cut or copied in Files.");
		const target = to ?? this.filesCwd;
		if (clipboard.mode === "cut") {
			const placed = await this.moveFiles(clipboard.paths, target);
			// Cut entries go once; their old paths are gone.
			this.fileClipboard = null;
			this.changed();
			return { mode: "cut", placed };
		}
		return {
			mode: "copy",
			placed: await this.copyFiles(clipboard.paths, target),
		};
	}

	/**
	 * Resolves an `f` ref from the Files window and acts on it. `byUser`: the
	 * user's click, so a launcher runs as their own command.
	 */
	async openFileRef(
		ref: string,
		options: { byUser?: boolean } = {},
	): Promise<void> {
		const match = listFileRefs({
			cwd: this.filesCwd,
			entries: this.fileEntries,
		}).find((candidate) => candidate.ref === ref);
		if (!match) {
			throw new Error(
				`${ref} is not in the Files window. Read the screen again.`,
			);
		}
		if (match.target.kind === "up") return this.openFolder(match.target.path);
		if (match.target.kind === "new-file") {
			return this.openFile(await this.nextUntitledPath(), { create: true });
		}
		return match.target.entry.type === "dir"
			? this.openFolder(match.target.entry.path)
			: this.openFile(match.target.entry.path, options);
	}

	private async nextUntitledPath(): Promise<string> {
		const names = new Set(this.fileEntries.map((entry) => entry.name));
		let index = 1;
		while (names.has(`untitled-${index}.md`)) index += 1;
		return normalizePath(`untitled-${index}.md`, this.filesCwd);
	}

	setEditorContent(content: string): void {
		if (!this.editorPath) throw new Error("No file is open in the Editor.");
		this.editorContent = content;
		this.editorSaved = false;
		this.changed();
	}

	/**
	 * Refused when the file changed on disk since the content was based on it
	 * (the agent or another window wrote it), unless `overwrite` says to
	 * replace that. `base` is the text the edits started from when it is not
	 * the Editor's own: the user's window edits a draft of its own.
	 */
	async saveEditor(
		options: { base?: string; overwrite?: boolean } = {},
	): Promise<void> {
		const path = this.editorPath;
		if (!path) throw new Error("No file is open in the Editor.");
		if (!options.overwrite) {
			const base = options.base ?? this.editorBase;
			const disk = await this.readEditorFile(path);
			if (disk !== null && disk !== base) {
				this.editorConflict = disk;
				this.changed();
				throw new Error(
					`${path} changed on disk since it was opened, so saving would replace those changes. Open it again to see the new content, then make the change again.`,
				);
			}
		}
		const previousBase = this.editorBase;
		// Before the write, so its own change notice finds the expected text.
		this.editorBase = this.editorContent;
		try {
			await this.ports.files.write(path, this.editorContent);
		} catch (error) {
			this.editorBase = previousBase;
			throw error;
		}
		this.editorSaved = true;
		this.editorConflict = null;
		if (parentOf(path) === this.filesCwd) await this.refreshFiles();
		else this.changed();
	}

	/** Drops the Editor's unsaved edits and shows the file as it is on disk. */
	async reloadEditor(): Promise<void> {
		const path = this.editorPath;
		if (!path) throw new Error("No file is open in the Editor.");
		const disk = await this.readEditorFile(path);
		if (disk === null) throw new Error(`Could not read ${path}.`);
		this.editorContent = disk;
		this.editorBase = disk;
		this.editorSaved = true;
		this.editorConflict = null;
		this.changed();
	}

	/** Shows the user the real page behind the active Browser tab. */
	async showBrowserTab(): Promise<void> {
		const tab = this.activeTab();
		if (!tab) throw new Error("No page is open in the Browser.");
		if (tab.kind === "embedded") {
			// The page is in the Browser window itself.
			this.focusWindow(this.openWindow("browser").id);
			return;
		}
		await this.ports.browser.focus(tab.sessionId);
	}

	// ── Visualize ───────────────────────────────────────────────────────────

	/**
	 * Shows a visual (OpenUI Lang) and keeps it as a file: the given path, or
	 * ~/Visuals/<title>.openui. Showing the open visual again updates its file.
	 */
	async showVisual(
		source: string,
		options: { path?: string; title?: string } = {},
	): Promise<string> {
		this.requireApp("visualize");
		const text = source.trim();
		if (!/^root\s*=/m.test(text)) {
			throw new Error(
				'A visual starts with its root: root = CardBlock("Title", "Description", [section_1, …]), then one line per section.',
			);
		}
		const title = options.title?.trim() || visualTitle(text, null);
		let path: string;
		if (options.path?.trim()) {
			path = this.resolvePath(options.path);
			if (!path.endsWith(MEMON_VISUAL_EXTENSION))
				path += MEMON_VISUAL_EXTENSION;
		} else {
			const dir = `${this.home}/${MEMON_VISUALS_DIR}`;
			const name = `${visualFileName(title)}${MEMON_VISUAL_EXTENSION}`;
			const same = normalizePath(name, dir);
			// The visual on screen is updated in place; another one is kept.
			path =
				same === this.visualPath
					? same
					: await this.freeName(dir, name, "move");
		}
		await this.ports.files.write(path, `${text}\n`);
		this.visualPath = path;
		this.visualSource = text;
		this.visualScreenLine = 0;
		this.visualError = undefined;
		this.focusWindow(this.openWindow("visualize").id);
		if (parentOf(path) === this.filesCwd) await this.refreshFiles();
		return path;
	}

	/** Opens a saved visual. */
	async openVisual(path: string): Promise<void> {
		this.requireApp("visualize");
		const target = this.resolvePath(path);
		let source: string;
		try {
			source = await this.ports.files.read(target);
		} catch (error) {
			throw new Error(
				`Could not open ${target}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		this.visualPath = target;
		this.visualSource = source.trim();
		this.visualScreenLine = 0;
		this.visualError = undefined;
		this.focusWindow(this.openWindow("visualize").id);
	}

	/** Saves the open visual's source, as the user edited it. */
	async saveVisual(source: string): Promise<void> {
		this.requireApp("visualize");
		if (!this.visualPath) throw new Error("No visual is open in Visualize.");
		const text = source.trim();
		await this.ports.files.write(this.visualPath, `${text}\n`);
		this.visualSource = text;
		this.visualError = undefined;
		this.changed();
	}

	// ── Tasks ───────────────────────────────────────────────────────────────

	/**
	 * Opens the Tasks window the first time it has something, without taking
	 * focus: the agent keeps reading the window it is working in.
	 */
	private showTasks(): void {
		if (this.windowFor("tasks")) return;
		this.windowSeq += 1;
		this.windows.push({
			id: `w${this.windowSeq}`,
			app: "tasks",
			...DEFAULT_LAYOUT.tasks,
			z: ++this.zSeq,
			minimized: false,
			maximized: false,
		});
		this.focusedWindowId ??= `w${this.windowSeq}`;
	}

	/** A task by its number (#3). */
	taskById(id: number): MemonTask {
		const task = this.taskItems.find((candidate) => candidate.id === id);
		if (!task) {
			const open = this.taskItems
				.filter((candidate) => isTaskOpen(candidate.state))
				.map((candidate) => `#${candidate.id}`);
			throw new Error(
				`Tasks has no task #${id}.${open.length ? ` Open tasks: ${open.join(", ")}.` : ""}`,
			);
		}
		return task;
	}

	private tasksChanged(task?: MemonTask): void {
		if (task) task.updatedAt = Date.now();
		this.saveTasks();
		this.showTasks();
		this.changed();
	}

	/**
	 * Adds a task. One the user adds is approved; one the agent adds is new
	 * (a proposal the user approves) unless it gives the state, e.g. starting
	 * a task the user asked for.
	 */
	addTask(input: {
		title: string;
		checklist?: readonly string[];
		state?: MemonTaskState;
		by: "agent" | "user";
	}): MemonTask {
		this.requireApp("tasks");
		const title = input.title.trim();
		if (!title) throw new Error("A task needs a title.");
		const now = Date.now();
		const state = input.state ?? (input.by === "user" ? "approved" : "new");
		const task: MemonTask = {
			id: Math.max(0, ...this.taskItems.map((item) => item.id)) + 1,
			title,
			state,
			checklist: (input.checklist ?? [])
				.map((text) => text.trim())
				.filter(Boolean)
				.map((text) => ({ text, done: false })),
			createdBy: input.by,
			createdAt: now,
			updatedAt: now,
			...(isTaskOpen(state) ? {} : { finishedAt: now }),
		};
		this.taskItems.push(task);
		this.tasksChanged();
		return task;
	}

	/** Moves a task to another state; done and dropped ones keep their time. */
	setTaskState(id: number, state: MemonTaskState): MemonTask {
		this.requireApp("tasks");
		const task = this.taskById(id);
		if (task.state === state) return task;
		task.state = state;
		if (isTaskOpen(state)) delete task.finishedAt;
		else task.finishedAt = Date.now();
		this.tasksChanged(task);
		return task;
	}

	/**
	 * Renames a task or replaces its checklist. A line starting with "[x]"
	 * is ticked and "[ ]" is not; other lines keep the tick of the item with
	 * the same text.
	 */
	editTask(
		id: number,
		change: { title?: string; checklist?: readonly string[] },
	): MemonTask {
		this.requireApp("tasks");
		const task = this.taskById(id);
		if (change.title !== undefined) {
			if (!change.title.trim()) throw new Error("A task needs a title.");
			task.title = change.title.trim();
		}
		if (change.checklist) {
			const before = [...task.checklist];
			task.checklist = change.checklist.flatMap((line) => {
				const mark = /^\s*\[( |x|X)?\]\s*/.exec(line);
				const text = (mark ? line.slice(mark[0].length) : line).trim();
				if (!text) return [];
				const same = before.findIndex((item) => item.text === text);
				const kept = same >= 0 ? before.splice(same, 1)[0] : undefined;
				return [
					{
						text,
						done: mark ? /x/i.test(mark[1] ?? "") : (kept?.done ?? false),
					},
				];
			});
		}
		this.tasksChanged(task);
		return task;
	}

	/** Adds items to the end of a task's checklist. */
	addTaskItems(id: number, items: readonly string[]): MemonTask {
		this.requireApp("tasks");
		const task = this.taskById(id);
		const added = items.map((text) => text.trim()).filter(Boolean);
		if (!added.length) throw new Error("Give the items to add.");
		task.checklist.push(...added.map((text) => ({ text, done: false })));
		this.tasksChanged(task);
		return task;
	}

	/** Ticks or unticks a checklist item (1-based). */
	checkTaskItem(
		id: number,
		item: number,
		done: boolean,
	): { task: MemonTask; text: string } {
		this.requireApp("tasks");
		const task = this.taskById(id);
		const entry = task.checklist[item - 1];
		if (!entry) {
			throw new Error(
				`Task #${id} has no item ${item}; its checklist has ${task.checklist.length}.`,
			);
		}
		entry.done = done;
		this.tasksChanged(task);
		return { task, text: entry.text };
	}

	/** Deletes a task for good; only the user does this. */
	removeTask(id: number): MemonTask {
		this.requireApp("tasks");
		const task = this.taskById(id);
		this.taskItems = this.taskItems.filter((candidate) => candidate !== task);
		this.tasksChanged();
		return task;
	}

	// ── Scheduler ───────────────────────────────────────────────────────────

	/**
	 * The agent using the computer, set by its runs, with its home when
	 * known. The same agent with another home was renamed: the computer
	 * follows its folder.
	 */
	setAgent(agentId: string | undefined, home?: string): void {
		if (!agentId) return;
		if (agentId === this.agentId) {
			if (home) this.setHome(home, true);
			return;
		}
		this.agentId = agentId;
		// A new agent brings its own home, tasks and history.
		if (home) this.setHome(home, false);
		else void this.refreshHome(false).catch(() => undefined);
		this.agentName = undefined;
		this.schedules = [];
		this.schedulesError = undefined;
		this.changed();
		if (this.windowFor("scheduler")) void this.refreshSchedules();
		if (this.windowFor("skills")) void this.refreshSkills();
		if (this.windowFor("connections")) void this.refreshConnections();
	}

	async refreshSchedules(): Promise<void> {
		if (!this.agentId) {
			this.schedules = [];
			this.schedulesError =
				"This computer has no agent yet, so it has no schedules.";
			this.changed();
			return;
		}
		this.schedulesLoading = true;
		this.changed();
		try {
			const { agentName, items } = await this.ports.scheduler.list(
				this.agentId,
			);
			this.agentName = agentName;
			this.schedules = items;
			this.schedulesError = undefined;
		} catch (error) {
			this.schedulesError =
				error instanceof Error ? error.message : String(error);
		} finally {
			this.schedulesLoading = false;
			this.changed();
		}
	}

	/** Opens the Scheduler and reads the schedules fresh. */
	async openScheduler(): Promise<void> {
		this.openWindow("scheduler");
		await this.refreshSchedules();
	}

	// ── Studio ──────────────────────────────────────────────────────────────

	/** Reads which studio tools have a model, with their voices and tasks. */
	async refreshStudio(): Promise<MemonStudioToolState[]> {
		this.studioLoading = true;
		this.changed();
		try {
			this.studioTools = await this.ports.studio.tools(true);
			this.studioError = undefined;
		} catch (error) {
			this.studioError = error instanceof Error ? error.message : String(error);
		} finally {
			this.studioLoading = false;
			this.changed();
		}
		return this.studioTools;
	}

	/** Opens Studio, showing one tool's runs (or all of them). */
	async openStudio(tool?: MemonStudioToolId | null): Promise<void> {
		this.openWindow("studio");
		if (tool !== undefined) this.studioSelected = tool;
		await this.refreshStudio();
	}

	selectStudioTool(tool: MemonStudioToolId | null): void {
		this.studioSelected = tool;
		this.changed();
	}

	/**
	 * Opens a `.studio` app: Studio with its tool chosen and the form filled
	 * from its settings, ready for an input. Returns the app.
	 */
	async openStudioApp(path: string): Promise<MemonStudioAppFile> {
		const target = this.resolvePath(path);
		let content: string;
		try {
			content = await this.ports.files.read(target);
		} catch (error) {
			throw new Error(
				`Could not open ${target}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		let config: MemonStudioAppConfig;
		try {
			config = parseStudioAppFile(content, target);
		} catch (error) {
			throw new Error(
				`${memonDisplayPath(target, this.homeDir)} is not a studio app: ${error instanceof Error ? error.message : String(error)}.`,
			);
		}
		this.openWindow("studio");
		this.studioSelected = config.tool;
		this.studioAppFile = { path: target, ...config };
		for (const [key, value] of Object.entries(
			studioDraftsFromSettings(config.tool, config.settings),
		)) {
			if (value === undefined) this.drafts.delete(key);
			else this.drafts.set(key, value);
		}
		this.changed();
		await this.refreshStudio();
		return { ...this.studioAppFile };
	}

	/**
	 * Keeps a studio tool and its settings as a `.studio` app (in the home
	 * unless `name` is a path), so the desktop opens it ready to run. The
	 * open app is saved over; another file of that name is kept.
	 */
	async saveStudioApp(
		name: string,
		config: Omit<MemonStudioAppConfig, "title"> & { title?: string },
	): Promise<string> {
		const wanted = this.appFilePath(name, MEMON_STUDIO_EXTENSION);
		const path =
			wanted === this.studioAppFile?.path ||
			!(await this.ports.files.exists(wanted))
				? wanted
				: await this.freeName(
						parentOf(wanted),
						wanted.slice(wanted.lastIndexOf("/") + 1),
						"move",
					);
		const title =
			config.title?.trim() ||
			path.slice(path.lastIndexOf("/") + 1).replace(/\.studio$/i, "");
		const saved: MemonStudioAppConfig = {
			tool: config.tool,
			title,
			settings: config.settings,
		};
		await this.ports.files.write(path, serializeStudioAppFile(saved));
		this.studioAppFile = { path, ...saved };
		await this.refreshDesktop();
		return path;
	}

	/** Leaves the open `.studio` app: the form is the tool's own again. */
	closeStudioApp(): void {
		this.studioAppFile = null;
		this.changed();
	}

	/**
	 * Runs a studio tool in the Studio window. The user watches the run there
	 * and sees its audio, images and answers; the agent gets the result as
	 * text. With saveTo, the whole text result is also written to that file.
	 */
	async runStudio(
		request: MemonStudioRequest,
		saveTo?: string,
	): Promise<MemonStudioRun> {
		if (saveTo) this.requireApp("files");
		this.openWindow("studio");
		this.studioSelected = request.tool;
		this.studioSeq += 1;
		const run: MemonStudioRun = {
			id: `s${this.studioSeq}`,
			tool: request.tool,
			status: "running",
			input: request.text?.trim() || request.path || request.tool,
			parts: [],
			startedAt: Date.now(),
		};
		if (this.studioAppFile && this.studioAppFile.tool === request.tool) {
			run.app = this.studioAppFile.title;
		}
		this.studioRuns = [run, ...this.studioRuns].slice(0, MAX_STUDIO_RUNS);
		this.changed();
		try {
			const outcome = await this.ports.studio.run(request, {
				sessionKey: `memon:${this.key}`,
				agentId: this.agentId,
			});
			Object.assign(run, {
				status: "done",
				input: outcome.input,
				text: outcome.text,
				parts: outcome.parts,
				model: outcome.model,
				conversationId: outcome.conversationId,
				itemId: outcome.itemId,
			} satisfies Partial<MemonStudioRun>);
			if (saveTo) {
				await this.ports.files.write(saveTo, outcome.fullText);
				run.text = `${outcome.text}\nSaved the whole result to ${saveTo}.`;
			}
			return run;
		} catch (error) {
			run.status = "failed";
			run.error = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			this.changed();
		}
	}

	// ── Skills ──────────────────────────────────────────────────────────────

	private requireAgent(app: string): string {
		if (!this.agentId) {
			throw new Error(
				`This computer has no agent yet, so ${app} has nothing to change. Start it from an agent, or chat with one.`,
			);
		}
		return this.agentId;
	}

	/** Re-reads the skill library and which skills the agent uses. */
	async refreshSkills(): Promise<void> {
		this.skillsLoading = true;
		this.changed();
		try {
			const { agentName, items } = await this.ports.skills.list(this.agentId);
			this.agentName = agentName ?? this.agentName;
			this.skillItems = items;
			this.skillsError = undefined;
		} catch (error) {
			this.skillsError = error instanceof Error ? error.message : String(error);
		} finally {
			this.skillsLoading = false;
			this.changed();
		}
	}

	async openSkills(): Promise<void> {
		this.openWindow("skills");
		await this.refreshSkills();
	}

	private skillNamed(name: string): MemonSkillItem {
		const wanted = name.trim().toLowerCase();
		const skill = this.skillItems.find((item) => item.name === wanted);
		if (!skill) {
			throw new Error(
				`There is no skill "${name}". Skills: ${this.skillItems.map((item) => item.name).join(", ") || "none"}.`,
			);
		}
		return skill;
	}

	/** Opens a skill's instructions in the Skills window. */
	async openSkill(name: string): Promise<MemonOpenSkill> {
		this.openWindow("skills");
		if (!this.skillItems.length) await this.refreshSkills();
		const skill = await this.ports.skills.read(this.skillNamed(name).name);
		this.openedSkill = skill;
		this.changed();
		return skill;
	}

	closeSkill(): void {
		this.openedSkill = null;
		this.changed();
	}

	/** Turns a skill on or off for the agent; it applies from the next run. */
	async setSkillEnabled(name: string, enabled: boolean): Promise<void> {
		const agentId = this.requireAgent("Skills");
		if (!this.skillItems.length) await this.refreshSkills();
		await this.ports.skills.setEnabled(
			agentId,
			this.skillNamed(name).name,
			enabled,
		);
		await this.refreshSkills();
	}

	async saveSkill(skill: {
		name: string;
		description: string;
		body: string;
	}): Promise<void> {
		await this.ports.skills.save(skill);
		await this.refreshSkills();
		if (this.openedSkill?.name === skill.name || this.windowFor("skills")) {
			this.openedSkill = await this.ports.skills.read(skill.name);
			this.changed();
		}
	}

	async deleteSkill(name: string): Promise<void> {
		if (!this.skillItems.length) await this.refreshSkills();
		const skill = this.skillNamed(name);
		if (skill.readOnly) {
			throw new Error(
				`"${skill.name}" is a built-in skill and cannot be deleted.`,
			);
		}
		await this.ports.skills.remove(skill.name);
		if (this.openedSkill?.name === skill.name) this.openedSkill = null;
		await this.refreshSkills();
	}

	// ── Connections ─────────────────────────────────────────────────────────

	async refreshConnections(): Promise<void> {
		this.connectionsLoading = true;
		this.changed();
		try {
			const { agentName, unlocked, items } = await this.ports.connections.list(
				this.agentId,
			);
			this.agentName = agentName ?? this.agentName;
			this.connectionsUnlocked = unlocked;
			this.connectionItems = items;
			this.connectionsError = undefined;
		} catch (error) {
			this.connectionsError =
				error instanceof Error ? error.message : String(error);
		} finally {
			this.connectionsLoading = false;
			this.changed();
		}
	}

	async openConnections(): Promise<void> {
		this.openWindow("connections");
		await this.refreshConnections();
	}

	/** A connection by its number in the Connections window (1-based). */
	connectionAt(number: number): MemonConnectionItem {
		const item = this.connectionItems[number - 1];
		if (!item) {
			throw new Error(
				`Connections has no connection ${number}; it has ${this.connectionItems.length}.`,
			);
		}
		return item;
	}

	selectConnection(key: string | null): void {
		this.selectedConnection = key;
		this.changed();
	}

	/** Grants or revokes a connection for the agent, from the next run. */
	async setConnectionGranted(key: string, granted: boolean): Promise<void> {
		const agentId = this.requireAgent("Connections");
		await this.ports.connections.setGranted(agentId, key, granted);
		await this.refreshConnections();
	}

	async rediscoverConnection(connectionId: string): Promise<void> {
		await this.ports.connections.refresh(connectionId);
		await this.refreshConnections();
	}

	/** A schedule by its number in the Scheduler (1-based). */
	scheduleAt(number: number): MemonSchedule {
		const schedule = this.schedules[number - 1];
		if (!schedule) {
			throw new Error(
				`The Scheduler has no schedule ${number}; it has ${this.schedules.length}.`,
			);
		}
		return schedule;
	}

	async saveSchedule(input: MemonScheduleInput): Promise<MemonSchedule> {
		if (!this.agentId) {
			throw new Error("This computer has no agent to schedule prompts for.");
		}
		const scheduleExpression = input.scheduleExpression.trim();
		const validation = validateCronExpression(scheduleExpression);
		if (!validation.valid) {
			throw new Error(
				`"${scheduleExpression}" is not a schedule: ${validation.error ?? "invalid cron"}. Use 5-field cron, e.g. "0 9 * * *" for every day at 09:00.`,
			);
		}
		if (!input.prompt.trim()) throw new Error("A schedule needs a prompt.");
		const saved = await this.ports.scheduler.save(this.agentId, {
			...input,
			name: input.name.trim() || "Scheduled prompt",
			prompt: input.prompt.trim(),
			scheduleExpression,
		});
		await this.refreshSchedules();
		return saved;
	}

	async deleteSchedule(id: string): Promise<MemonSchedule | undefined> {
		const existing = this.schedules.find((schedule) => schedule.id === id);
		await this.ports.scheduler.remove(id);
		await this.refreshSchedules();
		return existing;
	}

	// ── Snapshot ────────────────────────────────────────────────────────────

	/** The built-in apps on this computer: pi code only while it is on. */
	private builtInApps(): MemonBuiltinApp[] {
		return MEMON_BUILTIN_APPS.filter(
			(app) => app !== "pi" || this.config.piCode,
		);
	}

	private apps(): MemonAppAvailability[] {
		return MEMON_APP_IDS.map((id) => {
			const availability = this.appAvailability(id);
			return {
				id,
				enabled: this.config.apps[id],
				available: availability.available,
				reason: availability.reason,
			};
		});
	}

	snapshot(): MemonMachineSnapshot {
		return {
			key: this.key,
			revision: this.revision,
			driver: this.driver,
			status: this.status,
			apps: this.apps(),
			builtInApps: this.builtInApps(),
			windows: this.windows.map((window) => ({ ...window })),
			focusedWindowId: this.focusedWindowId,
			browser: {
				tabs: this.tabs.map((tab) => ({ ...tab })),
				activeTabId: this.activeTabId,
				windowId: this.browserWindowId,
			},
			files: {
				cwd: this.filesCwd,
				entries: [...this.fileEntries],
				error: this.filesError,
				clipboard: this.fileClipboard
					? {
							mode: this.fileClipboard.mode,
							paths: [...this.fileClipboard.paths],
						}
					: null,
				exported: this.fileExport ? { ...this.fileExport } : null,
			},
			editor: {
				path: this.editorPath,
				content: this.editorContent,
				saved: this.editorSaved,
				screenLine: this.editorScreenLine,
				...(this.editorConflict !== null
					? { conflict: this.editorConflict }
					: {}),
			},
			tasks: {
				items: this.taskItems.map((task) => ({
					...task,
					checklist: task.checklist.map((item) => ({ ...item })),
				})),
				path: this.tasksFile,
				error: this.tasksError,
			},
			scheduler: {
				agentId: this.agentId,
				agentName: this.agentName,
				items: this.schedules.map((schedule) => ({ ...schedule })),
				loading: this.schedulesLoading,
				error: this.schedulesError,
			},
			skills: {
				agentId: this.agentId,
				agentName: this.agentName,
				items: this.skillItems.map((item) => ({ ...item })),
				open: this.openedSkill ? { ...this.openedSkill } : null,
				loading: this.skillsLoading,
				error: this.skillsError,
			},
			connections: {
				agentId: this.agentId,
				agentName: this.agentName,
				items: this.connectionItems.map((item) => ({
					...item,
					tools: [...item.tools],
				})),
				unlocked: this.connectionsUnlocked,
				selected: this.selectedConnection,
				loading: this.connectionsLoading,
				error: this.connectionsError,
			},
			studio: {
				tools: this.studioTools.map((tool) => ({ ...tool })),
				selected: this.studioSelected,
				app: this.studioAppFile
					? {
							...this.studioAppFile,
							settings: { ...this.studioAppFile.settings },
						}
					: null,
				runs: this.studioRuns.map((run) => ({ ...run })),
				loading: this.studioLoading,
				error: this.studioError,
			},
			viewer: {
				path: this.viewerPath,
				kind: this.viewerKind,
				size: this.viewerSize,
				text: this.viewerText,
				loading: this.viewerLoading,
				error: this.viewerError,
				screenLine: this.viewerScreenLine,
			},
			terminal: { ...this.terminal.snapshot(), historyPath: this.historyFile },
			cursor: this.cursor,
			desktop: [...this.desktopEntries],
			home: this.home,
			visual: {
				path: this.visualPath,
				title: visualTitle(this.visualSource, this.visualPath),
				source: this.visualSource,
				theme: this.config.visualTheme,
				screenLine: this.visualScreenLine,
				error: this.visualError,
			},
			piCode: this.piCode.state(),
			pendingUserChanges: [...this.userChanges],
			drafts: Object.fromEntries(this.drafts),
			updatedAt: this.lastActiveAt,
		};
	}

	summary(): MemonMachineSummary {
		return {
			key: this.key,
			revision: this.revision,
			driver: this.driver,
			status: this.status,
			focusedWindowId: this.focusedWindowId,
			windows: this.windows.map(({ id, app, minimized }) => ({
				id,
				app,
				minimized,
			})),
			cursor: this.cursor,
			showComputer: this.config.showComputer,
			updatedAt: this.lastActiveAt,
		};
	}
}
