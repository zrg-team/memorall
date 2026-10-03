import type { TFunction } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stores = vi.hoisted(() => ({
	sendTextToChat: vi.fn(),
	sendDocumentRefsToChat: vi.fn(),
	setChatShellCollapsed: vi.fn(),
}));

vi.mock("@/main/stores/workspace-mode", () => ({
	useWorkspaceModeStore: {
		getState: () => ({
			sendTextToChat: stores.sendTextToChat,
			sendDocumentRefsToChat: stores.sendDocumentRefsToChat,
		}),
	},
}));

vi.mock("@/main/stores/shell-layout", () => ({
	useShellLayoutStore: {
		getState: () => ({ setChatShellCollapsed: stores.setChatShellCollapsed }),
	},
}));

import type {
	MemonMachineSnapshot,
	MemonWindowState,
} from "@/services/memon/types";
import { askInChat, memonWindowTarget } from "../ask-in-chat";

const t = ((key: string, options?: Record<string, string>) =>
	key === "memonComputer.ask.lead"
		? `From the computer (${options?.source}):`
		: key) as unknown as TFunction;

const window = (app: MemonWindowState["app"]): MemonWindowState => ({
	id: "w1",
	app,
	x: 0,
	y: 0,
	w: 1,
	h: 1,
	z: 1,
	minimized: false,
	maximized: false,
});

const snapshot = (
	overrides: Partial<MemonMachineSnapshot> = {},
): MemonMachineSnapshot => ({
	key: "conversation-1",
	revision: 1,
	driver: "agent",
	status: "idle",
	apps: [],
	windows: [],
	focusedWindowId: null,
	browser: { tabs: [], activeTabId: null },
	files: { cwd: "/", entries: [] },
	editor: { path: null, content: "", saved: true, screenLine: 0 },
	viewer: { path: null, kind: null, text: "", loading: false, screenLine: 0 },
	notes: { items: [], text: "" },
	scheduler: { agentId: null, items: [], loading: false },
	studio: { tools: [], selected: null, runs: [], loading: false },
	skills: { agentId: null, items: [], open: null, loading: false },
	connections: {
		agentId: null,
		items: [],
		unlocked: true,
		selected: null,
		loading: false,
	},
	terminal: {
		cwd: "/",
		lines: [],
		runningProcessId: null,
		runningCommand: null,
		startedAt: null,
		lastOutputAt: null,
		lastExitCode: 0,
		approval: null,
		tabs: [{ id: "1", cwd: "/", running: false }],
		activeTabId: "1",
		runningTabId: null,
	},
	cursor: null,
	desktop: [],
	pendingUserChanges: [],
	drafts: {},
	home: "/agents/guest",
	visual: {
		path: null,
		title: "Untitled visual",
		source: "",
		theme: "shadcn",
		screenLine: 0,
	},
	updatedAt: 0,
	...overrides,
});

describe("askInChat", () => {
	beforeEach(() => vi.clearAllMocks());

	it("attaches a PDF the way an @mention does", () => {
		askInChat({ kind: "file", source: "Files · /", path: "/docs/q3.pdf" }, t);

		expect(stores.sendDocumentRefsToChat).toHaveBeenCalledWith([
			{
				path: "/docs/q3.pdf",
				name: "q3.pdf",
				mimeType: "application/pdf",
				docType: "pdf",
			},
		]);
		expect(stores.sendTextToChat).not.toHaveBeenCalled();
		expect(stores.setChatShellCollapsed).toHaveBeenCalledWith(false);
	});

	it("names a video by path, since chat cannot attach it", () => {
		askInChat({ kind: "file", source: "Files · /", path: "/clips/a.mp4" }, t);

		expect(stores.sendDocumentRefsToChat).not.toHaveBeenCalled();
		expect(stores.sendTextToChat).toHaveBeenCalledWith(
			"From the computer (Files · /):\n> /clips/a.mp4\n\n",
		);
	});

	it("quotes text line by line", () => {
		askInChat(
			{ kind: "text", source: "Browser · Example", text: "first\nsecond" },
			t,
		);

		expect(stores.sendTextToChat).toHaveBeenCalledWith(
			"From the computer (Browser · Example):\n> first\n> second\n\n",
		);
	});
});

describe("memonWindowTarget", () => {
	it("takes the terminal's last command and its output", () => {
		const target = memonWindowTarget(
			snapshot({
				terminal: {
					cwd: "/app",
					lines: [
						{ kind: "command", text: "ls", cwd: "/app" },
						{ kind: "stdout", text: "a.txt" },
						{ kind: "command", text: "npm test", cwd: "/app" },
						{ kind: "stderr", text: "1 failed" },
					],
					runningProcessId: null,
					runningCommand: null,
					startedAt: null,
					lastOutputAt: null,
					lastExitCode: 1,
					approval: null,
					tabs: [{ id: "1", cwd: "/app", running: false }],
					activeTabId: "1",
					runningTabId: null,
				},
			}),
			window("terminal"),
		);

		expect(target).toEqual({
			kind: "text",
			source: "Terminal · /app",
			text: "$ npm test\n1 failed",
		});
	});

	it("quotes unsaved editor text instead of attaching the stale file", () => {
		const target = memonWindowTarget(
			snapshot({
				editor: {
					path: "/notes/a.md",
					content: "draft",
					saved: false,
					screenLine: 0,
				},
			}),
			window("editor"),
		);

		expect(target).toEqual({
			kind: "text",
			source: "Editor · /notes/a.md",
			text: "draft",
		});
	});
});
