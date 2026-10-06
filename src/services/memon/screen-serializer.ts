import { formatPageOutline } from "@/co-agent/dom/page-outline";
import { renderViewText } from "./app-kit/render-text";
import { isKitApp, MEMON_KIT_APPS } from "./apps";
import { describeSchedule } from "./apps/scheduler-view";
import {
	MEMON_SCREEN_CHAR_BUDGET,
	MEMON_TEXT_PAGE_LINES,
	memonDisplayPath,
	memonHomePaths,
} from "./constants";
import { isTaskOpen, taskProgress } from "./tasks-file";
import type {
	MemonFileEntry,
	MemonFilesState,
	MemonMachineSnapshot,
	MemonPiCodeEntry,
	MemonTerminalLine,
	MemonTerminalState,
	MemonTerminalTab,
	MemonWindowState,
} from "./types";
import { terminalRunsInFront } from "./terminal/terminal-state";

/**
 * The screen the model reads. Pure, so the Computer panel's "Screen text"
 * view and every tool result show exactly the same text.
 *
 * Only the focused window is shown in full; the others get one line each.
 * Element refs are namespaced by app: `b` browser (from the page outline),
 * `f` files, `e` editor, `t` terminal.
 */

const APP_LABEL: Record<MemonWindowState["app"], string> = {
	browser: "Browser",
	files: "Files",
	editor: "Editor",
	viewer: "Viewer",
	terminal: "Terminal",
	tasks: "Tasks",
	scheduler: "Scheduler",
	studio: "Studio",
	skills: "Skills",
	connections: "Connections",
	visualize: "Visualize",
	pi: "pi code",
};

/** pi code in one line: what it is doing and on which model. */
const piCodeBrief = (
	snapshot: MemonMachineSnapshot,
	windowId: string,
	min: string,
): string => {
	const pi = snapshot.piCode;
	const state = pi?.approval
		? "waiting for the user to allow your request"
		: pi?.status === "error"
			? `error: ${pi.error ?? "unknown"}`
			: pi?.status === "running"
				? pi.working
					? `working${pi.activity ? `: ${pi.activity}` : ""}`
					: "idle"
				: pi?.status === "choosing"
					? "the user picks a folder to open"
					: "starting";
	const where = pi?.cwd ? ` · ${memonDisplayPath(pi.cwd, snapshot.home)}` : "";
	const model = pi?.model
		? ` · ${pi.model}${pi.thinkingLevel && pi.thinkingLevel !== "off" ? ` (thinking ${pi.thinkingLevel})` : ""}`
		: pi?.status === "running"
			? " · no model selected"
			: "";
	const context =
		pi?.contextPercent !== undefined ? ` · context ${pi.contextPercent}%` : "";
	const name = pi?.sessionName
		? ` · "${truncateLine(pi.sessionName, 40)}"`
		: "";
	return `── ${windowId} pi code${min} · ${state}${where}${model}${context}${name}`;
};

const PI_ENTRY_MARK: Record<MemonPiCodeEntry["kind"], string> = {
	user: "user:",
	assistant: "pi:",
	tool: "  tool",
	bash: "  !",
	summary: "  …",
	error: "  error:",
};

const piCodeEntryLine = (entry: MemonPiCodeEntry): string => {
	if (entry.kind === "tool") {
		return `  ${entry.failed ? "✗" : "✓"} ${entry.name ?? "tool"} ${entry.text}`.trimEnd();
	}
	if (entry.kind === "bash") {
		return `  ${entry.failed ? "✗" : "✓"} ! ${entry.text}`;
	}
	return `${PI_ENTRY_MARK[entry.kind]} ${entry.text}`;
};

/** Room pi's conversation gets on the screen; the newest entries first. */
const PI_TRANSCRIPT_CHARS = 3_600;

/**
 * pi code in front: what it does, the agent's request waiting for the user,
 * and the latest of its conversation (the last answer in full).
 */
const piCodeLines = (
	snapshot: MemonMachineSnapshot,
	windowId: string,
	scroll: number,
): string[] => {
	const pi = snapshot.piCode;
	const lines = [piCodeBrief(snapshot, windowId, "")];
	if (pi?.approval) {
		lines.push(
			`your request waits for the user in this window: "${truncateLine(pi.approval.task, 200)}"`,
		);
	}
	if (pi?.status !== "running") {
		if (pi?.status === "choosing") {
			lines.push(
				'(pi starts once the user picks a folder; memon_code { action: "prompt", text, cwd } starts it in the one you name)',
			);
		} else if (!pi?.approval) {
			lines.push("(pi is not running)");
		}
		return lines;
	}
	const body = piCodeBody(snapshot);
	if (!body?.lines.length) {
		lines.push("(no conversation yet: hand pi work with memon_code)");
	} else {
		const { start, end } = pageOf(body, scroll);
		const left = (pi.earlier ?? 0) + start;
		const scrollUp = start
			? ` — scroll up to see ${start === left ? "them" : `the last ${start}`}`
			: "";
		const below = body.lines.length - end;
		lines.push(
			`conversation${left ? ` (${left} earlier entr${left === 1 ? "y" : "ies"} left out${scrollUp})` : ""}:`,
			...body.lines.slice(start, end),
			...(below
				? [
						`(… ${below} newer entr${below === 1 ? "y" : "ies"} below — scroll down to see them)`,
					]
				: []),
		);
	}
	for (const queued of pi.queued ?? []) {
		lines.push(
			`queued ${queued.mode === "followUp" ? "follow-up" : "steer"}: ${truncateLine(queued.text, 160)}`,
		);
	}
	lines.push(
		pi.working
			? 'memon_code { action: "wait" } waits for it · a prompt steers it · { action: "stop" } stops it'
			: 'memon_code { action: "prompt", text } gives it more work',
	);
	return lines;
};

export { describeSchedule };

/** The open tasks by state, and the one in progress: one line. */
const tasksSummary = (snapshot: MemonMachineSnapshot): string | null => {
	const open = snapshot.tasks.items.filter((task) => isTaskOpen(task.state));
	if (!open.length) return null;
	const count = (state: string) =>
		open.filter((task) => task.state === state).length;
	const parts = [
		count("in_progress") && `${count("in_progress")} in progress`,
		count("approved") && `${count("approved")} approved (waiting for you)`,
		count("new") && `${count("new")} new (waiting for the user's approval)`,
	].filter(Boolean);
	const now = open.find((task) => task.state === "in_progress");
	const progress = now ? taskProgress(now) : null;
	return `tasks: ${parts.join(" · ")}${now ? ` · now: #${now.id} ${truncateLine(now.title, 60)}${now.checklist.length ? ` (${progress?.done}/${progress?.total})` : ""}` : ""}`;
};

const TERMINAL_TAIL_LINES = 12;

const formatElapsed = (startedAt: number | null): string => {
	if (startedAt === null) return "";
	const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** One page of a long text, with where it sits in the whole. */
const textPage = (
	text: string,
	screenLine: number,
): { lines: string[]; footer: string | null } => {
	const all = text.split("\n");
	const start = Math.min(screenLine, Math.max(0, all.length - 1));
	const end = Math.min(all.length, start + MEMON_TEXT_PAGE_LINES);
	const lines = all
		.slice(start, end)
		.map((line) => `  ${truncateLine(line, 160)}`);
	if (all.length <= MEMON_TEXT_PAGE_LINES) return { lines, footer: null };
	return {
		lines,
		footer: `  (lines ${start + 1}–${end} of ${all.length}; scroll up/down to page)`,
	};
};

/** Room a window's list gets on the screen; longer ones scroll. */
const WINDOW_PAGE_CHARS = 4_500;

/** The part of a window the agent scrolls: a list, or output read from the newest. */
interface ScrollBody {
	lines: string[];
	/** Room for one page, in characters. */
	room: number;
	/** Newest at the bottom: the scroll counts lines back from the end. */
	tail: boolean;
	/** At the end and not scrolled, only this many lines show (the Terminal's tail). */
	liveLines?: number;
}

/** Where the page that starts at `start` ends; at least one line. */
const pageEnd = (lines: string[], start: number, room: number): number => {
	let end = start;
	let used = 0;
	while (
		end < lines.length &&
		(end === start || used + lines[end].length <= room)
	) {
		used += lines[end].length + 1;
		end += 1;
	}
	return end;
};

/** Where the page that ends at `end` starts; at least one line. */
const pageStart = (lines: string[], end: number, room: number): number => {
	let start = end;
	let used = 0;
	while (
		start > 0 &&
		(start === end || used + lines[start - 1].length <= room)
	) {
		used += lines[start - 1].length + 1;
		start -= 1;
	}
	return start;
};

/** The lines of the page a window is scrolled to. */
const pageOf = (
	body: ScrollBody,
	scroll: number,
): { start: number; end: number } => {
	const { lines, room } = body;
	if (body.tail) {
		const back = Math.min(Math.max(0, scroll), Math.max(0, lines.length - 1));
		const end = lines.length - back;
		if (!back && body.liveLines !== undefined) {
			return { start: Math.max(0, end - body.liveLines), end };
		}
		return { start: pageStart(lines, end, room), end };
	}
	const start = Math.min(
		Math.max(0, scroll),
		pageStart(lines, lines.length, room),
	);
	return { start, end: pageEnd(lines, start, room) };
};

/** A window's list as it scrolls: one page, with what is above and below it. */
const scrolledLines = (body: ScrollBody, scroll: number): string[] => {
	const { start, end } = pageOf(body, scroll);
	const below = body.lines.length - end;
	return [
		...(start > 0
			? [
					`(… ${start} ${body.tail ? "earlier " : ""}lines above — scroll up to see them)`,
				]
			: []),
		...body.lines.slice(start, end),
		...(below > 0
			? [
					`(… ${below} ${body.tail ? "newer" : "more"} lines below — scroll down to see them)`,
				]
			: []),
	];
};

export type MemonFileRefTarget =
	| { kind: "up"; path: string }
	| { kind: "entry"; entry: MemonFileEntry }
	| { kind: "new-file" };

/** Refs for the Files window, in display order. */
export const listFileRefs = (
	files: MemonFilesState,
): Array<{ ref: string; target: MemonFileRefTarget }> => {
	const refs: Array<{ ref: string; target: MemonFileRefTarget }> = [];
	let n = 1;
	if (files.cwd !== "/") {
		const parent = files.cwd.replace(/\/[^/]+\/?$/, "") || "/";
		refs.push({ ref: `f${n++}`, target: { kind: "up", path: parent } });
	}
	for (const entry of files.entries) {
		refs.push({ ref: `f${n++}`, target: { kind: "entry", entry } });
	}
	refs.push({ ref: `f${n}`, target: { kind: "new-file" } });
	return refs;
};

const formatSize = (size?: number): string =>
	size === undefined
		? ""
		: size < 1024
			? ` · ${size} B`
			: ` · ${(size / 1024).toFixed(1)} KB`;

const truncateLine = (value: string, max: number): string =>
	value.length > max ? `${value.slice(0, max - 1)}…` : value;

const windowLabel = (window: MemonWindowState): string => APP_LABEL[window.app];

// ── Terminal ─────────────────────────────────────────────────────────────

const terminalLine = (line: MemonTerminalLine): string =>
	line.kind === "command"
		? `$ ${line.text}`
		: line.kind === "input"
			? `> ${line.text}`
			: truncateLine(line.text, 240);

/** The running command, and how long it has been quiet. */
const runningState = (terminal: MemonTerminalState): string => {
	if (!terminal.runningCommand) return "";
	const quiet =
		terminal.lastOutputAt !== null &&
		Date.now() - terminal.lastOutputAt >= 5_000
			? ` · no output for ${formatElapsed(terminal.lastOutputAt)}`
			: "";
	return `running \`${truncateLine(terminal.runningCommand, 60)}\` for ${formatElapsed(terminal.startedAt)}${quiet}`;
};

/** " · serving http://localhost:3000": the computer's servers, if any. */
const servingNote = (terminal: MemonTerminalState): string =>
	terminal.servers?.length
		? ` · serving ${terminal.servers.map((port) => `http://localhost:${port}`).join(", ")}`
		: "";

const terminalBrief = (
	windowId: string,
	min: string,
	terminal: MemonTerminalState,
	home: string,
): string => {
	const front = terminal.tabs.find((tab) => tab.id === terminal.activeTabId);
	const state = terminal.approval?.agentWaiting
		? "waiting for the user's approval"
		: terminal.runningCommand
			? `tab ${terminal.runningTabId} running \`${truncateLine(terminal.runningCommand, 40)}\` for ${formatElapsed(terminal.startedAt)}`
			: front?.command
				? `last: $ ${truncateLine(front.command, 48)} (exit ${front.lastExitCode ?? "?"})`
				: "idle";
	const tabCount =
		terminal.tabs.length > 1
			? ` · ${terminal.tabs.length} tabs, tab ${terminal.activeTabId} in front`
			: "";
	return `── ${windowId} Terminal${min}${tabCount} · cwd ${memonDisplayPath(terminal.cwd, home)} · ${state}${servingNote(terminal)}`;
};

/** A tab as one line: where it is, what runs in it or what it last ran. */
const terminalTabLine = (
	terminal: MemonTerminalState,
	tab: MemonTerminalTab,
	home: string,
): string => {
	const front = tab.id === terminal.activeTabId ? "*" : " ";
	const state = tab.running
		? `running \`${truncateLine(tab.command ?? terminal.runningCommand ?? "", 60)}\` for ${formatElapsed(terminal.startedAt)}${servingNote(terminal)}`
		: tab.command
			? `last: $ ${truncateLine(tab.command, 60)} (exit ${tab.lastExitCode ?? "?"})`
			: "nothing run yet";
	const earlier = (tab.recent ?? []).slice(0, -1).reverse().slice(0, 3);
	return `  ${tab.id}${front} ${memonDisplayPath(tab.cwd, home)} · ${state}${earlier.length ? ` · before: ${earlier.map((command) => truncateLine(command, 30)).join(", ")}` : ""}`;
};

const terminalTabsLines = (
	terminal: MemonTerminalState,
	home: string,
): string[] =>
	terminal.tabs.length < 2
		? []
		: [
				'tabs (* in front) — memon_run { terminal: "<id>" } switches (with command, runs there) · { terminal: "new", command } runs in a new tab · { terminal: "<id>", closeTab: true } closes:',
				...terminal.tabs.map((tab) => terminalTabLine(terminal, tab, home)),
			];

/** The running tab's latest output, while another tab is in front. */
const runningTabLines = (terminal: MemonTerminalState): string[] =>
	terminal.runningTabTail?.length
		? [
				`tab ${terminal.runningTabId}'s latest output (memon_run { terminal: "${terminal.runningTabId}" } shows it all):`,
				...terminal.runningTabTail.map((line) => `  | ${terminalLine(line)}`),
				`tab ${terminal.activeTabId}:`,
			]
		: [];

const approvalLines = (terminal: MemonTerminalState): string[] =>
	terminal.approval
		? [
				`waiting for the user's approval: $ ${terminal.approval.command}`,
				`  ${terminal.approval.reason}`,
			]
		: [];

const serverLines = (terminal: MemonTerminalState): string[] =>
	terminal.servers?.length
		? [
				`serving ${terminal.servers.map((port) => `http://localhost:${port}`).join(", ")} — a server keeps running; memon_open { app: "browser", url: "http://localhost:${terminal.servers[0]}" } shows it in an embedded tab`,
			]
		: [];

const terminalInputHint = (terminal: MemonTerminalState): string =>
	terminalRunsInFront(terminal)
		? "[t1] input → the running command (memon_run { input } / { stop: true }); memon_run { command } runs a command that finishes next to it; another long one waits until it stops"
		: terminal.runningCommand
			? "[t1] input (use memon_run for commands; while the other tab's command runs, commands here must finish)"
			: terminal.tabs.length > 1
				? "[t1] input (use memon_run for commands)"
				: '[t1] input (use memon_run for commands; { terminal: "new", command } opens another tab)';

const terminalBody = (terminal: MemonTerminalState): ScrollBody => ({
	lines: terminal.lines.map(terminalLine),
	room: WINDOW_PAGE_CHARS,
	tail: true,
	liveLines: TERMINAL_TAIL_LINES,
});

const terminalLines = (
	windowId: string,
	terminal: MemonTerminalState,
	home: string,
	scroll: number,
): string[] => {
	const running = runningState(terminal);
	const state = terminalRunsInFront(terminal)
		? running
		: `idle · last exit ${terminal.lastExitCode ?? "-"}${running ? ` · tab ${terminal.runningTabId} is ${running}` : ""}`;
	const tab =
		terminal.tabs.length > 1
			? ` · tab ${terminal.activeTabId} of ${terminal.tabs.length}`
			: "";
	return [
		`── ${windowId} Terminal${tab} · cwd ${memonDisplayPath(terminal.cwd, home)} · ${state}`,
		...terminalTabsLines(terminal, home),
		...runningTabLines(terminal),
		...scrolledLines(terminalBody(terminal), scroll),
		...approvalLines(terminal),
		...serverLines(terminal),
		terminalInputHint(terminal),
	];
};

const briefLine = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
): string => {
	const min = window.minimized ? " (minimized)" : "";
	switch (window.app) {
		case "browser": {
			const tab = snapshot.browser.tabs.find(
				(candidate) => candidate.id === snapshot.browser.activeTabId,
			);
			const count = snapshot.browser.tabs.length;
			return `── ${window.id} Browser${min} · "${truncateLine(tab?.title || tab?.url || "new tab", 60)}" · ${count} tab${count === 1 ? "" : "s"}`;
		}
		case "visualize": {
			const { visual } = snapshot;
			return visual.path
				? `── ${window.id} Visualize${min} · "${truncateLine(visual.title, 60)}" · ${memonDisplayPath(visual.path, snapshot.home)}`
				: `── ${window.id} Visualize${min} · nothing open`;
		}
		case "files":
			return `── ${window.id} Files${min} · ${memonDisplayPath(snapshot.files.cwd, snapshot.home)} · ${snapshot.files.entries.length} items`;
		case "editor":
			return `── ${window.id} Editor${min} · ${snapshot.editor.path ? memonDisplayPath(snapshot.editor.path, snapshot.home) : "untitled"} · ${snapshot.editor.saved ? "saved" : "unsaved"}`;
		case "viewer":
			return `── ${window.id} Viewer${min} · ${snapshot.viewer.path ?? "nothing open"}${snapshot.viewer.kind ? ` · ${snapshot.viewer.kind}` : ""}`;
		case "tasks": {
			const open = snapshot.tasks.items.filter((task) =>
				isTaskOpen(task.state),
			).length;
			const finished = snapshot.tasks.items.length - open;
			const file =
				snapshot.tasks.path &&
				snapshot.tasks.path !== memonHomePaths(snapshot.home).tasks
					? ` · ${memonDisplayPath(snapshot.tasks.path, snapshot.home)}`
					: "";
			return `── ${window.id} Tasks${min}${file} · ${open} open${finished ? ` · ${finished} finished` : ""}`;
		}
		case "scheduler":
			return `── ${window.id} Scheduler${min} · ${snapshot.scheduler.items.length} schedule${snapshot.scheduler.items.length === 1 ? "" : "s"}`;
		case "skills": {
			const { items } = snapshot.skills;
			const inUse = items.filter((item) => item.enabled).length;
			return `── ${window.id} Skills${min} · ${inUse} of ${items.length} in use`;
		}
		case "connections": {
			const { items } = snapshot.connections;
			const granted = items.filter((item) => item.granted).length;
			return `── ${window.id} Connections${min} · ${granted} of ${items.length} granted`;
		}
		case "studio": {
			const { tools, runs } = snapshot.studio;
			const ready = tools.filter((tool) => tool.ready).length;
			const running = runs.some((run) => run.status === "running");
			return `── ${window.id} Studio${min} · ${ready}/${tools.length} tools ready · ${runs.length} run${runs.length === 1 ? "" : "s"}${running ? " · running" : ""}`;
		}
		case "terminal":
			return terminalBrief(window.id, min, snapshot.terminal, snapshot.home);
		case "pi":
			return piCodeBrief(snapshot, window.id, min);
	}
};

const fullLines = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
): string[] => {
	const scroll = window.scroll ?? 0;
	// Apps built with the kit: the window's own controls, with their refs.
	if (isKitApp(window.app)) {
		const body = scrollBodyOf(snapshot, window);
		return [
			briefLine(snapshot, { ...window, minimized: false }),
			...(body ? scrolledLines(body, scroll) : []),
		];
	}
	switch (window.app) {
		case "browser": {
			const { tabs, activeTabId } = snapshot.browser;
			const index = tabs.findIndex((tab) => tab.id === activeTabId);
			const tab = tabs[index];
			const lines = [
				`── ${window.id} Browser · tab ${index + 1} of ${tabs.length}${tab?.kind === "embedded" ? " · embedded (a server in this computer, shown in the window)" : ""}`,
			];
			if (!tab) return [...lines, "(no page open — use memon_open with a url)"];
			lines.push(`url: ${tab.url}`, `title: ${tab.title || "(untitled)"}`);
			if (tabs.length > 1) {
				lines.push(
					`tabs: ${tabs
						.map(
							(candidate, i) =>
								`${i + 1}${candidate.id === activeTabId ? "*" : ""} "${truncateLine(candidate.title || candidate.url, 32)}"${candidate.kind === "embedded" ? " (embedded)" : ""}`,
						)
						.join(" · ")}`,
				);
			}
			if (tab.error) lines.push(`error: ${tab.error}`);
			if (tab.wall) {
				lines.push(
					snapshot.browser.wallTabId === tab.id
						? `blocked: ${tab.wall.description} The user was asked to solve it in the real page; your next action waits until they have.`
						: `blocked: ${tab.wall.description} Only a person can get past it: ask the user to solve it in the real page.`,
				);
			}
			if (tab.outline) {
				lines.push(`page: ${tab.outline.docToken}`);
				const { scroll } = tab.outline;
				if (scroll?.viewportWidth) {
					lines.push(
						`viewport: ${scroll.viewportWidth}×${scroll.viewportHeight}, scrolled ${scroll.y} of ${Math.max(0, scroll.pageHeight - scroll.viewportHeight)} px (x, y are in it)`,
					);
				}
				lines.push(formatPageOutline(tab.outline));
				if (tab.outline.busy) {
					lines.push(
						"(the page was still loading when read — memon_screen with waitSeconds reads it again)",
					);
				}
			} else {
				lines.push("(page not read yet)");
			}
			return lines;
		}
		case "files": {
			const lines = [
				`── ${window.id} Files · ${memonDisplayPath(snapshot.files.cwd, snapshot.home)}`,
			];
			if (snapshot.files.error) lines.push(`error: ${snapshot.files.error}`);
			lines.push(
				...scrolledLines(
					{
						lines: fileLines(snapshot.files),
						room: WINDOW_PAGE_CHARS,
						tail: false,
					},
					scroll,
				),
			);
			const clipboard = snapshot.files.clipboard;
			if (clipboard) {
				const names = clipboard.paths.map(
					(path) => path.split("/").pop() ?? path,
				);
				lines.push(
					`clipboard: ${clipboard.mode} ${truncateLine(names.join(", "), 160)} — memon_act { action: "paste" } puts ${names.length === 1 ? "it" : "them"} in this folder`,
				);
			}
			return lines;
		}
		case "editor": {
			const { editor } = snapshot;
			const page = textPage(editor.content, editor.screenLine);
			const lines = [
				`── ${window.id} Editor · ${editor.path ?? "untitled"} · ${editor.saved ? "saved" : "unsaved"} · ${editor.content.split("\n").length} lines`,
				...(editor.conflict !== undefined
					? [
							"(the file changed on disk under these unsaved edits; saving is refused so it is not replaced — open the file again to see it, then redo the change)",
						]
					: []),
				"[e1] text:",
				...page.lines,
			];
			if (page.footer) lines.push(page.footer);
			lines.push('[e2] button "Save"');
			return lines;
		}
		case "visualize": {
			const { visual } = snapshot;
			if (!visual.path) {
				return [
					`── ${window.id} Visualize · nothing open`,
					"(show a visual with memon_visualize, or open a .openui file)",
				];
			}
			const page = textPage(visual.source, visual.screenLine);
			const lines = [
				`── ${window.id} Visualize · "${truncateLine(visual.title, 60)}" · ${memonDisplayPath(visual.path, snapshot.home)} · ${visual.source.split("\n").length} lines`,
				"The user sees it drawn; its OpenUI source:",
				...page.lines,
			];
			if (page.footer) lines.push(page.footer);
			if (visual.error) lines.push(`error: ${visual.error}`);
			return lines;
		}
		case "viewer": {
			const { viewer } = snapshot;
			const lines = [
				`── ${window.id} Viewer · ${viewer.path ?? "nothing open"}${viewer.kind ? ` · ${viewer.kind}` : ""}${formatSize(viewer.size)}`,
			];
			if (viewer.loading) return [...lines, "(opening…)"];
			if (viewer.error) return [...lines, `error: ${viewer.error}`];
			const page = textPage(viewer.text, viewer.screenLine);
			lines.push(...page.lines);
			if (page.footer) lines.push(page.footer);
			return lines;
		}
		case "terminal":
			return terminalLines(window.id, snapshot.terminal, snapshot.home, scroll);
		case "pi":
			return piCodeLines(snapshot, window.id, scroll);
		default:
			return [];
	}
};

/** The Files list: a line for each ref. */
const fileLines = (files: MemonFilesState): string[] =>
	listFileRefs(files).map(({ ref, target }) =>
		target.kind === "up"
			? `[${ref}] .. (up)`
			: target.kind === "new-file"
				? `[${ref}] button "New file"`
				: target.entry.type === "dir"
					? `[${ref}] ${target.entry.name}/`
					: `[${ref}] ${target.entry.name}${formatSize(target.entry.size)}`,
	);

/** pi's conversation, an entry a line, while pi runs. */
const piCodeBody = (snapshot: MemonMachineSnapshot): ScrollBody | null =>
	snapshot.piCode?.status === "running"
		? {
				lines: (snapshot.piCode.transcript ?? []).map(piCodeEntryLine),
				room: PI_TRANSCRIPT_CHARS,
				tail: true,
			}
		: null;

/** What scrolls in a window that pages by itself here (not Browser, Editor, Viewer or Visualize). */
const scrollBodyOf = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
): ScrollBody | null => {
	if (isKitApp(window.app)) {
		const app = MEMON_KIT_APPS[window.app];
		return {
			lines: renderViewText(app.view(snapshot), app.refPrefix),
			room: WINDOW_PAGE_CHARS,
			tail: false,
		};
	}
	switch (window.app) {
		case "files":
			return {
				lines: fileLines(snapshot.files),
				room: WINDOW_PAGE_CHARS,
				tail: false,
			};
		case "terminal":
			return terminalBody(snapshot.terminal);
		case "pi":
			return piCodeBody(snapshot);
		default:
			return null;
	}
};

export type MemonWindowScrollDirection = "up" | "down" | "top" | "bottom";

/** A page that way from where the window's list is, as its `scroll`. */
const scrollToward = (
	body: ScrollBody,
	from: { start: number; end: number },
	direction: MemonWindowScrollDirection,
): number => {
	const { lines, room } = body;
	const { start, end } = from;
	if (body.tail) {
		const back = (to: number) => lines.length - to;
		if (direction === "bottom") return 0;
		if (direction === "top") return back(pageEnd(lines, 0, room));
		if (direction === "up") return back(start > 0 ? start : end);
		return back(end < lines.length ? pageEnd(lines, end, room) : end);
	}
	const last = pageStart(lines, lines.length, room);
	if (direction === "top") return 0;
	if (direction === "bottom") return last;
	if (direction === "up") return pageStart(lines, start, room);
	return Math.min(end, last);
};

/**
 * Where a window's list goes on a scroll, as `scroll` for the window, and
 * whether what shows changes. Null when the window has no list to scroll.
 */
export const nextWindowScroll = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
	direction: MemonWindowScrollDirection,
): { scroll: number; moved: boolean } | null => {
	const body = scrollBodyOf(snapshot, window);
	if (!body) return null;
	const before = pageOf(body, window.scroll ?? 0);
	const scroll = scrollToward(body, before, direction);
	const after = pageOf(body, scroll);
	return {
		scroll,
		moved: after.start !== before.start || after.end !== before.end,
	};
};

/** A window's name on the screen. */
export const memonWindowLabel = (app: MemonWindowState["app"]): string =>
	APP_LABEL[app];

export const serializeScreen = (
	snapshot: MemonMachineSnapshot,
	options: { budget?: number } = {},
): string => {
	const budget = options.budget ?? MEMON_SCREEN_CHAR_BUDGET;
	const focused = snapshot.windows.find(
		(window) => window.id === snapshot.focusedWindowId && !window.minimized,
	);
	const available = snapshot.apps.filter((app) => app.enabled);
	const lines = [
		`screen · driver: ${snapshot.driver === "agent" ? "MemonOS Bot" : "user"} · focus: ${focused?.id ?? "desktop"}`,
		`windows: ${
			snapshot.windows.length
				? snapshot.windows
						.map(
							(window) =>
								`${window.id} ${windowLabel(window)}${window === focused ? "*" : ""}${window.minimized ? " (min)" : ""}`,
						)
						.join(" · ")
				: "none"
		}`,
		`apps: ${
			available
				.map((app) =>
					app.available
						? APP_LABEL[app.id]
						: `${APP_LABEL[app.id]} (unavailable: ${app.reason ?? "not supported here"})`,
				)
				.join(" · ") || "none"
		}`,
	];
	const tasks = tasksSummary(snapshot);
	if (tasks) lines.push(tasks);
	if (snapshot.desktop.length) {
		lines.push(
			`desktop (~): ${snapshot.desktop
				.map((entry) => `${entry.name}${entry.type === "dir" ? "/" : ""}`)
				.join(" · ")}`,
		);
	}
	if (snapshot.pendingUserChanges.length) {
		lines.push("", "user changes since your last screen:");
		for (const change of snapshot.pendingUserChanges) lines.push(`- ${change}`);
	}
	const ordered = focused
		? [focused, ...snapshot.windows.filter((window) => window !== focused)]
		: snapshot.windows;
	for (const window of ordered) {
		lines.push("");
		if (window === focused) lines.push(...fullLines(snapshot, window));
		else lines.push(briefLine(snapshot, window));
	}
	if (!snapshot.windows.length) {
		lines.push("", "(desktop is empty — open an app with memon_open)");
	}
	const text = lines.join("\n");
	return text.length > budget
		? `${text.slice(0, budget)}\n(… screen truncated — focus a window or scroll to see more)`
		: text;
};
