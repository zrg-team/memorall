import type { TFunction } from "i18next";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import { sortTasks, taskStateLabel } from "@/services/memon/apps/tasks-view";
import {
	memonAttachmentType,
	memonMimeType,
} from "@/services/memon/file-kinds";
import type {
	MemonMachineSnapshot,
	MemonWindowState,
} from "@/services/memon/types";

/** Something on the computer the user wants to ask about. */
export type MemonAskTarget =
	| { kind: "text"; source: string; text: string }
	| { kind: "file"; source: string; path: string }
	| { kind: "folder"; source: string; path: string };

const MAX_QUOTE_CHARS = 4_000;
const TERMINAL_CONTEXT_LINES = 40;

/** Where on the computer a target is, for the chat text. */
export const memonWindowSource = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
): string => {
	switch (window.app) {
		case "browser": {
			const tab = snapshot.browser.tabs.find(
				(candidate) => candidate.id === snapshot.browser.activeTabId,
			);
			return tab ? `Browser · ${tab.title || tab.url} — ${tab.url}` : "Browser";
		}
		case "files":
			return `Files · ${snapshot.files.cwd}`;
		case "editor":
			return `Editor · ${snapshot.editor.path ?? "untitled"}`;
		case "viewer":
			return `Viewer · ${snapshot.viewer.path ?? ""}`;
		case "terminal":
			return `Terminal · ${snapshot.terminal.cwd}`;
		case "tasks":
			return "Tasks";
		case "scheduler":
			return `Scheduler · ${snapshot.scheduler.agentName ?? "this agent"}`;
		case "studio":
			return "Studio";
		case "skills":
			return snapshot.skills.open
				? `Skills · ${snapshot.skills.open.name}`
				: "Skills";
		case "connections":
			return "Connections";
		case "visualize":
			return snapshot.visual.path
				? `Visualize · ${snapshot.visual.title} — ${snapshot.visual.path}`
				: "Visualize";
		case "pi":
			return snapshot.piCode?.cwd
				? `pi code · ${snapshot.piCode.cwd}`
				: "pi code";
	}
};

/** The whole window as a target: its page, folder, file or last command. */
export const memonWindowTarget = (
	snapshot: MemonMachineSnapshot,
	window: MemonWindowState,
): MemonAskTarget | null => {
	const source = memonWindowSource(snapshot, window);
	switch (window.app) {
		case "browser": {
			const tab = snapshot.browser.tabs.find(
				(candidate) => candidate.id === snapshot.browser.activeTabId,
			);
			return tab
				? { kind: "text", source, text: `${tab.title || tab.url}\n${tab.url}` }
				: null;
		}
		case "files":
			return { kind: "folder", source, path: snapshot.files.cwd };
		case "editor": {
			const { editor } = snapshot;
			if (!editor.path) return null;
			// Unsaved text is not on disk yet, so it goes in as a quote.
			return editor.saved
				? { kind: "file", source, path: editor.path }
				: { kind: "text", source, text: editor.content };
		}
		case "viewer":
			return snapshot.viewer.path
				? { kind: "file", source, path: snapshot.viewer.path }
				: null;
		case "visualize":
			return snapshot.visual.path
				? { kind: "file", source, path: snapshot.visual.path }
				: null;
		case "tasks": {
			const { open } = sortTasks(snapshot.tasks.items);
			const body = open.flatMap((task) => [
				`#${task.id} ${task.title} (${taskStateLabel(task.state)})`,
				...task.checklist.map(
					(item) => `  ${item.done ? "[x]" : "[ ]"} ${item.text}`,
				),
			]);
			return body.length
				? { kind: "text", source, text: body.join("\n") }
				: null;
		}
		case "scheduler": {
			const { items } = snapshot.scheduler;
			return items.length
				? {
						kind: "text",
						source,
						text: items
							.map(
								(schedule, index) =>
									`${index + 1}. [${schedule.status}] ${schedule.name} (${schedule.scheduleExpression}): ${schedule.prompt}`,
							)
							.join("\n"),
					}
				: null;
		}
		case "studio": {
			const runs = snapshot.studio.runs.filter(
				(run) =>
					!snapshot.studio.selected || run.tool === snapshot.studio.selected,
			);
			const latest = runs.find((run) => run.status !== "running");
			return latest
				? {
						kind: "text",
						source,
						text: [`${latest.tool}: ${latest.input}`, latest.text ?? ""]
							.filter(Boolean)
							.join("\n"),
					}
				: null;
		}
		case "skills": {
			const { open, items } = snapshot.skills;
			if (open) {
				return {
					kind: "text",
					source,
					text: `${open.name}: ${open.description}\n\n${open.body}`,
				};
			}
			return items.length
				? {
						kind: "text",
						source,
						text: items
							.map(
								(item) =>
									`[${item.enabled ? "on" : "off"}] ${item.name}: ${item.description}`,
							)
							.join("\n"),
					}
				: null;
		}
		case "connections": {
			const { items } = snapshot.connections;
			return items.length
				? {
						kind: "text",
						source,
						text: items
							.map(
								(item) =>
									`[${item.granted ? "granted" : "not granted"}] ${item.label} (${item.status}, ${item.tools.length} tools)`,
							)
							.join("\n"),
					}
				: null;
		}
		case "terminal": {
			const { lines } = snapshot.terminal;
			let start = lines.length - 1;
			while (start > 0 && lines[start].kind !== "command") start -= 1;
			const tail = lines
				.slice(Math.max(start, lines.length - TERMINAL_CONTEXT_LINES))
				.map((line) =>
					line.kind === "command" ? `$ ${line.text}` : line.text,
				);
			return tail.length
				? { kind: "text", source, text: tail.join("\n") }
				: null;
		}
		case "pi": {
			// Its screen is a terminal; the folder it works in is what to ask about.
			const cwd = snapshot.piCode?.cwd;
			return cwd ? { kind: "folder", source, path: cwd } : null;
		}
	}
};

const quote = (text: string): string => {
	const trimmed =
		text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS)}…` : text;
	return trimmed
		.trim()
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
};

/**
 * Puts the target in the chat composer without sending it: files become
 * attachments (like an @mention), everything else a quote to ask about.
 */
export const askInChat = (target: MemonAskTarget, t: TFunction): void => {
	const workspace = useWorkspaceModeStore.getState();
	useShellLayoutStore.getState().setChatShellCollapsed(false);
	if (target.kind === "file") {
		const docType = memonAttachmentType(target.path);
		if (docType) {
			workspace.sendDocumentRefsToChat([
				{
					path: target.path,
					name: target.path.split("/").pop() ?? target.path,
					mimeType: memonMimeType(target.path),
					docType,
				},
			]);
			return;
		}
	}
	const lead = t("memonComputer.ask.lead", { source: target.source });
	const body =
		target.kind === "text"
			? quote(target.text)
			: `> ${target.kind === "folder" ? t("memonComputer.ask.folder", { path: target.path }) : target.path}`;
	workspace.sendTextToChat(`${lead}\n${body}\n\n`);
};
