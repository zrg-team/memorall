import type {
	WebHistoryDirection,
	WebOutlineActionRequest,
	WebOutlineActionResult,
	WebPageOutline,
} from "@/services/web-browser/web-browser-protocol";
import {
	MEMON_AGENT_TURN_CEILING_MS,
	MEMON_APP_IDS,
	MEMON_GUEST_HOME,
	MEMON_NOTES_EXTENSION,
	MEMON_TERMINAL_EXTENSION,
	MEMON_VISUAL_EXTENSION,
	MEMON_VISUALS_DIR,
	memonDisplayPath,
	memonHomePaths,
	MEMON_TEXT_PAGE_LINES,
	type MemonAppId,
	type MemonStudioToolId,
	type MemonWindowApp,
} from "./constants";
import { MemonFileSync } from "./file-sync";
import { parseNotesFile, serializeNotesFile } from "./notes-file";
import {
	parseTerminalHistory,
	serializeTerminalHistory,
} from "./terminal/terminal-history";
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
	type MemonDesktopEntryChange,
} from "./desktop-files";
import { memonFileKind, type MemonViewerKind } from "./file-kinds";
import { downloadFileName, MEMON_DOWNLOADS_DIR } from "./download";
import type { FolderZip } from "@/services/filesystem/folder-zip";
import { listFileRefs, serializeScreen } from "./screen-serializer";
import { controlsByRef } from "./app-kit/render-text";
import type { MemonControlValue } from "./app-kit/types";
import { kitAppForRef } from "./apps";
import { MemonApprovalRequiredError } from "./approval-error";
import type { MemonEmbeddedPort } from "./embedded-browser";
import { isLocalAddress, sandboxTargetOf } from "./embedded-frame";
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
	MemonNoteItem,
	MemonNoteStatus,
	MemonSchedule,
	MemonScheduleStatus,
	MemonMachineSummary,
	MemonStatus,
	MemonConnectionItem,
	MemonOpenSkill,
	MemonSkillItem,
	MemonStudioRun,
	MemonStudioToolState,
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
	act(
		sessionId: string,
		request: WebOutlineActionRequest,
	): Promise<{ result: WebOutlineActionResult; outline?: WebPageOutline }>;
	history(sessionId: string, direction: WebHistoryDirection): Promise<void>;
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
	notes: { x: 0.66, y: 0.04, w: 0.32, h: 0.62 },
	scheduler: { x: 0.18, y: 0.06, w: 0.6, h: 0.78 },
	studio: { x: 0.14, y: 0.05, w: 0.66, h: 0.82 },
	skills: { x: 0.2, y: 0.05, w: 0.6, h: 0.82 },
	connections: { x: 0.24, y: 0.06, w: 0.56, h: 0.8 },
	visualize: { x: 0.12, y: 0.04, w: 0.7, h: 0.88 },
};
/** The app each window needs turned on; built-in apps need none. */
const APP_OF_WINDOW: Record<MemonWindowApp, MemonAppId | null> = {
	browser: "browser",
	files: "files",
	editor: "files",
	viewer: "files",
	terminal: "terminal",
	notes: "notes",
	visualize: "visualize",
	scheduler: null,
	studio: null,
	skills: null,
	connections: null,
};
/** Extracted text kept for the agent; a very long PDF is cut here. */
const MAX_VIEWER_TEXT_CHARS = 60_000;
const MAX_USER_CHANGES = 12;
const MAX_STUDIO_RUNS = 20;
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
	private viewerPath: string | null = null;
	private viewerKind: MemonViewerKind | null = null;
	private viewerText = "";
	private viewerSize: number | undefined;
	private viewerLoading = false;
	private viewerError: string | undefined;
	private viewerScreenLine = 0;
	private noteItems: MemonNoteItem[] = [];
	private notesText = "";
	private noteSeq = 0;
	/** The `.notes` file open in Notes; null is ~/my.notes. */
	private notesPath: string | null = null;
	private notesError: string | undefined;
	private readonly notesSync: MemonFileSync;
	/** The `.terminal` file the history is kept in; null is ~/my.terminal. */
	private historyPath: string | null = null;
	private readonly historySync: MemonFileSync;
	private agentId: string | null = null;
	private agentName: string | undefined;
	private schedules: MemonSchedule[] = [];
	private schedulesLoading = false;
	private schedulesError: string | undefined;
	private studioTools: MemonStudioToolState[] = [];
	private studioSelected: MemonStudioToolId | null = null;
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
		this.notesSync = new MemonFileSync(ports.files, "the notes");
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
			},
			ports,
		);
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	configure(config: MemonFeatureConfig): void {
		this.config = config;
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

	/** Waits for the notes and history writes started so far. */
	async flushWrites(): Promise<void> {
		await Promise.all([this.notesSync.flush(), this.historySync.flush()]);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.flushWrites();
		this.terminal.dispose();
		this.cancelWaits();
		this.unsubscribeFiles?.();
		this.unsubscribeDesktop?.();
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
		if (app === "notes" || app === "visualize") return { available: true };
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

	private async readTab(tab: MemonBrowserTab): Promise<void> {
		try {
			const outline = await this.browserPort(tab).outline(tab.sessionId);
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
	 * Opens a URL in the active tab, or in a new one. A local address
	 * (localhost:3000) opens embedded, where the computer's servers are, unless
	 * `embedded: false` asks for a real tab.
	 */
	async openUrl(
		input: string,
		options: { newTab?: boolean; embedded?: boolean } = {},
	): Promise<void> {
		this.requireApp("browser");
		const window = this.openWindow("browser");
		const url = normalizeBrowserUrl(input);
		const embedded =
			options.embedded ??
			(Boolean(this.ports.embedded) && sandboxTargetOf(url) !== null);
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
			await this.readTab(current);
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
		await this.readTab(tab);
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
		// A click can start a navigation that replaces the document after the
		// outline was taken; read again once it settles.
		if (!outline || request.action === "click" || request.action === "submit") {
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
		await this.readTab(tab);
	}

	async refreshBrowser(): Promise<void> {
		const tab = this.activeTab();
		if (tab) await this.readTab(tab);
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
	 * Creates Bot.md and Memory.md the first time, reads the notes and the
	 * command history from their files, and keeps the desktop (the home's
	 * files) and both apps current, whichever app (or the Files page) changes
	 * the files.
	 */
	async prepareDesktop(): Promise<void> {
		const home = this.homeDir;
		await loadMemonDesktopFiles(this.ports.files, home);
		if (home !== this.homeDir) return;
		await Promise.all([this.loadNotes(), this.loadHistory()]);
		await this.refreshDesktop();
		this.unsubscribeDesktop ??= this.ports.files.subscribe(() => {
			if (this.desktopRefreshTimer) clearTimeout(this.desktopRefreshTimer);
			this.desktopRefreshTimer = setTimeout(() => {
				this.desktopRefreshTimer = undefined;
				void this.refreshDesktop();
				void this.loadNotes();
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
	 * another agent's, with its own notes and history.
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
			this.notesPath = null;
			this.historyPath = null;
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

	private get notesFile(): string {
		return this.notesPath ?? memonHomePaths(this.homeDir).notes;
	}

	private get historyFile(): string {
		return this.historyPath ?? memonHomePaths(this.homeDir).terminal;
	}

	/** Keeps the notes in their file, ~/my.notes unless another is open. */
	private saveNotes(): void {
		this.notesError = undefined;
		this.notesSync.save(
			this.notesFile,
			serializeNotesFile({ items: this.noteItems, text: this.notesText }),
		);
	}

	/**
	 * Reads the notes from their file when it changed. A file that is not
	 * notes leaves them as they are, with the reason shown.
	 */
	private async loadNotes(): Promise<void> {
		const path = this.notesFile;
		const read = await this.notesSync.read(path);
		if (path !== this.notesFile || read.status === "same") return;
		if (read.status === "missing") {
			if (!this.noteItems.length && !this.notesText && !this.notesError) return;
			this.noteItems = [];
			this.notesText = "";
			this.notesError = undefined;
		} else {
			try {
				const notes = parseNotesFile(read.content);
				this.noteItems = notes.items.map((item) => ({
					...this.newNote(item.text),
					status: item.status,
				}));
				this.notesText = notes.text;
				this.notesError = undefined;
			} catch (error) {
				this.notesError = `${memonDisplayPath(path, this.homeDir)} is not notes: ${error instanceof Error ? error.message : String(error)}. The next change writes it again.`;
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

	/** Opens a `.notes` file in Notes; its steps and notes replace the open ones. */
	async openNotesFile(path: string): Promise<void> {
		this.requireApp("notes");
		const target = this.resolvePath(path);
		const isDefault = target === memonHomePaths(this.homeDir).notes;
		if (!isDefault && !(await this.ports.files.exists(target))) {
			throw new Error(`Could not open ${target}: there is no such file.`);
		}
		await this.notesSync.flush();
		this.notesPath = isDefault ? null : target;
		await this.loadNotes();
		this.focusWindow(this.openWindow("notes").id);
	}

	/** Opens a `.terminal` file in the Terminal: its history is the one kept. */
	async openTerminalFile(path: string): Promise<void> {
		this.requireApp("terminal");
		const target = this.resolvePath(path);
		const isDefault = target === memonHomePaths(this.homeDir).terminal;
		if (!isDefault && !(await this.ports.files.exists(target))) {
			throw new Error(`Could not open ${target}: there is no such file.`);
		}
		await this.historySync.flush();
		this.historyPath = isDefault ? null : target;
		await this.loadHistory();
		this.focusWindow(this.openWindow("terminal").id);
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
		options: { create?: boolean } = {},
	): Promise<void> {
		const target = this.resolvePath(path);
		// Like a desktop's file types: a .notes file opens in Notes and a
		// .terminal file in the Terminal, when the agent has them; else it is
		// JSON text, for the Editor.
		if (target.endsWith(MEMON_NOTES_EXTENSION) && this.config.apps.notes) {
			return this.openNotesFile(target);
		}
		if (
			target.endsWith(MEMON_TERMINAL_EXTENSION) &&
			this.config.apps.terminal &&
			this.terminal.availability.available
		) {
			return this.openTerminalFile(target);
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
		this.editorScreenLine = 0;
		const window = this.openWindow("editor");
		this.focusWindow(window.id);
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
		this.notesPath = moved(this.notesPath);
		this.historyPath = moved(this.historyPath);
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

	/** Resolves an `f` ref from the Files window and acts on it. */
	async openFileRef(ref: string): Promise<void> {
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
			: this.openFile(match.target.entry.path);
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

	async saveEditor(): Promise<void> {
		if (!this.editorPath) throw new Error("No file is open in the Editor.");
		await this.ports.files.write(this.editorPath, this.editorContent);
		this.editorSaved = true;
		if (parentOf(this.editorPath) === this.filesCwd) await this.refreshFiles();
		else this.changed();
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

	// ── Notes ───────────────────────────────────────────────────────────────

	/**
	 * Opens the Notes window the first time it has something, without taking
	 * focus: the agent keeps reading the window it is working in.
	 */
	private showNotes(): void {
		if (this.windowFor("notes")) return;
		this.windowSeq += 1;
		this.windows.push({
			id: `w${this.windowSeq}`,
			app: "notes",
			...DEFAULT_LAYOUT.notes,
			z: ++this.zSeq,
			minimized: false,
			maximized: false,
		});
		this.focusedWindowId ??= `w${this.windowSeq}`;
	}

	private noteAt(step: number): MemonNoteItem {
		const item = this.noteItems[step - 1];
		if (!item) {
			throw new Error(
				`Notes has no step ${step}; it has ${this.noteItems.length}.`,
			);
		}
		return item;
	}

	private newNote(text: string): MemonNoteItem {
		this.noteSeq += 1;
		return { id: `n${this.noteSeq}`, text: text.trim(), status: "todo" };
	}

	/** Replaces the checklist. */
	setNotes(items: string[]): void {
		this.requireApp("notes");
		this.noteItems = items
			.filter((text) => text.trim())
			.map((text) => this.newNote(text));
		this.saveNotes();
		this.showNotes();
		this.changed();
	}

	addNotes(items: string[]): void {
		this.requireApp("notes");
		this.noteItems.push(
			...items.filter((text) => text.trim()).map((text) => this.newNote(text)),
		);
		this.saveNotes();
		this.showNotes();
		this.changed();
	}

	/** Marks a step (1-based); starting one finishes no other. */
	setNoteStatus(step: number, status: MemonNoteStatus): MemonNoteItem {
		this.requireApp("notes");
		const item = this.noteAt(step);
		item.status = status;
		this.saveNotes();
		this.changed();
		return item;
	}

	removeNote(step: number): MemonNoteItem {
		this.requireApp("notes");
		const item = this.noteAt(step);
		this.noteItems = this.noteItems.filter((candidate) => candidate !== item);
		this.saveNotes();
		this.changed();
		return item;
	}

	writeNotesText(text: string): void {
		this.requireApp("notes");
		this.notesText = text;
		this.saveNotes();
		this.showNotes();
		this.changed();
	}

	/** Changes a step's wording (1-based). */
	editNote(step: number, text: string): MemonNoteItem {
		this.requireApp("notes");
		const item = this.noteAt(step);
		if (!text.trim()) throw new Error("A step needs some text.");
		item.text = text.trim();
		this.saveNotes();
		this.changed();
		return item;
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
		// A new agent brings its own home, notes and history.
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
		this.studioRuns = [run, ...this.studioRuns].slice(0, MAX_STUDIO_RUNS);
		this.changed();
		try {
			const outcome = await this.ports.studio.run(request, {
				sessionKey: `memon:${this.key}`,
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
			},
			notes: {
				items: this.noteItems.map((item) => ({ ...item })),
				text: this.notesText,
				path: this.notesFile,
				error: this.notesError,
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
