import { formatPageOutline } from "@/co-agent/dom/page-outline";
import { renderViewText } from "./app-kit/render-text";
import { isKitApp, MEMON_KIT_APPS } from "./apps";
import { describeSchedule } from "./apps/scheduler-view";
import {
	MEMON_SCREEN_CHAR_BUDGET,
	MEMON_TEXT_PAGE_LINES,
	memonDisplayPath,
} from "./constants";
import type {
	MemonFileEntry,
	MemonFilesState,
	MemonMachineSnapshot,
	MemonTerminalLine,
	MemonTerminalState,
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
	notes: "Notes",
	scheduler: "Scheduler",
	studio: "Studio",
	skills: "Skills",
	connections: "Connections",
	visualize: "Visualize",
};

export { describeSchedule };

const notesProgress = (snapshot: MemonMachineSnapshot): string => {
	const { items } = snapshot.notes;
	const done = items.filter((item) => item.status === "done").length;
	return `${done}/${items.length} done`;
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

const terminalBrief = (
	windowId: string,
	min: string,
	terminal: MemonTerminalState,
): string => {
	const last = [...terminal.lines]
		.reverse()
		.find((line) => line.kind === "command");
	const elsewhere = terminalRunsInFront(terminal)
		? ""
		: `tab ${terminal.runningTabId} `;
	const state = terminal.approval?.agentWaiting
		? "waiting for the user's approval"
		: terminal.runningCommand
			? `${elsewhere}running for ${formatElapsed(terminal.startedAt)}`
			: last
				? `last: $ ${truncateLine(last.text, 48)} (exit ${terminal.lastExitCode ?? "?"})`
				: "idle";
	const tabCount =
		terminal.tabs.length > 1 ? ` · ${terminal.tabs.length} tabs` : "";
	return `── ${windowId} Terminal${min}${tabCount} · cwd ${terminal.cwd} · ${state}`;
};

const terminalTabsLines = (terminal: MemonTerminalState): string[] => {
	if (terminal.tabs.length < 2) return [];
	const tabs = terminal.tabs
		.map(
			(tab) =>
				`${tab.id === terminal.activeTabId ? `[${tab.id}]` : tab.id} ${tab.cwd}${tab.running ? " (running)" : ""}`,
		)
		.join(" · ");
	return [
		`tabs: ${tabs} — memon_run { terminal: "<id>" } switches to a tab (with command, runs there), { terminal: "new" } opens one, { terminal: "<id>", closeTab: true } closes one`,
	];
};

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
		? "[t1] input → the running command (memon_run { input } / { stop: true }); file and text commands (ls, cat, mkdir, grep…), curl, git and py still run next to it"
		: terminal.runningCommand
			? "[t1] input (use memon_run for commands; while the other tab's command runs, only file and text commands, curl, git and py)"
			: "[t1] input (use memon_run for commands)";

const terminalLines = (
	windowId: string,
	terminal: MemonTerminalState,
): string[] => {
	const running = runningState(terminal);
	const state = terminalRunsInFront(terminal)
		? running
		: `idle · last exit ${terminal.lastExitCode ?? "-"}${running ? ` · tab ${terminal.runningTabId} is ${running}` : ""}`;
	const tab = terminal.tabs.length > 1 ? ` · tab ${terminal.activeTabId}` : "";
	return [
		`── ${windowId} Terminal${tab} · cwd ${terminal.cwd} · ${state}`,
		...terminalTabsLines(terminal),
		...runningTabLines(terminal),
		...terminal.lines.slice(-TERMINAL_TAIL_LINES).map(terminalLine),
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
		case "notes":
			return `── ${window.id} Notes${min} · ${notesProgress(snapshot)}`;
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
			return terminalBrief(window.id, min, snapshot.terminal);
	}
};

const fullLines = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
): string[] => {
	// Apps built with the kit: the window's own controls, with their refs.
	if (isKitApp(window.app)) {
		const app = MEMON_KIT_APPS[window.app];
		return [
			briefLine(snapshot, { ...window, minimized: false }),
			...renderViewText(app.view(snapshot), app.refPrefix),
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
			if (tab.outline) {
				lines.push(`page: ${tab.outline.docToken}`);
				lines.push(formatPageOutline(tab.outline));
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
			for (const { ref, target } of listFileRefs(snapshot.files)) {
				if (target.kind === "up") lines.push(`[${ref}] .. (up)`);
				else if (target.kind === "new-file")
					lines.push(`[${ref}] button "New file"`);
				else if (target.entry.type === "dir")
					lines.push(`[${ref}] ${target.entry.name}/`);
				else
					lines.push(
						`[${ref}] ${target.entry.name}${formatSize(target.entry.size)}`,
					);
			}
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
			return terminalLines(window.id, snapshot.terminal);
		default:
			return [];
	}
};

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
	const { items } = snapshot.notes;
	if (items.length) {
		const doing = items.find((item) => item.status === "doing");
		lines.push(
			`notes: ${notesProgress(snapshot)}${doing ? ` · now: ${truncateLine(doing.text, 80)}` : ""}`,
		);
	}
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
