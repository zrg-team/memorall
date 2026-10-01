import { describe, expect, it } from "vitest";
import { listFileRefs, serializeScreen } from "../screen-serializer";
import type { MemonMachineSnapshot } from "../types";

const snapshot = (
	overrides: Partial<MemonMachineSnapshot> = {},
): MemonMachineSnapshot => ({
	key: "conversation-1",
	revision: 3,
	driver: "agent",
	status: "working",
	apps: [
		{
			id: "browser",
			enabled: true,
			available: false,
			reason: "no browser here",
		},
		{ id: "files", enabled: true, available: true },
		{ id: "terminal", enabled: false, available: true },
	],
	windows: [
		{
			id: "w1",
			app: "files",
			x: 0,
			y: 0,
			w: 0.5,
			h: 0.5,
			z: 11,
			minimized: false,
			maximized: false,
		},
		{
			id: "w2",
			app: "terminal",
			x: 0,
			y: 0,
			w: 0.5,
			h: 0.5,
			z: 12,
			minimized: true,
			maximized: false,
		},
	],
	focusedWindowId: "w1",
	browser: { tabs: [], activeTabId: null },
	files: {
		cwd: "/notes",
		entries: [
			{ name: "topic", path: "/notes/topic", type: "dir" },
			{ name: "a.md", path: "/notes/a.md", type: "file", size: 2048 },
		],
	},
	editor: { path: null, content: "", saved: true, screenLine: 0 },
	viewer: {
		path: null,
		kind: null,
		text: "",
		loading: false,
		screenLine: 0,
	},
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
		cwd: "/notes",
		lines: [{ kind: "command", text: "ls", cwd: "/notes" }],
		runningProcessId: null,
		runningCommand: null,
		startedAt: null,
		lastOutputAt: null,
		lastExitCode: 0,
		approval: null,
	},
	cursor: null,
	desktop: [
		{ name: "Bot.md", path: "/.users/guest/Desktop/Bot.md", type: "file" },
		{
			name: "Memory.md",
			path: "/.users/guest/Desktop/Memory.md",
			type: "file",
		},
	],
	pendingUserChanges: [],
	drafts: {},
	home: "/.users/guest",
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

describe("serializeScreen", () => {
	it("shows the focused window in full and the others in one line", () => {
		const screen = serializeScreen(snapshot());

		expect(screen).toContain("screen · driver: MemonOS Bot · focus: w1");
		expect(screen).toContain("windows: w1 Files* · w2 Terminal (min)");
		expect(screen).toContain("── w1 Files · /notes");
		expect(screen).toContain("[f1] .. (up)");
		expect(screen).toContain("[f2] topic/");
		expect(screen).toContain("[f3] a.md · 2.0 KB");
		expect(screen).toContain('[f4] button "New file"');
		expect(screen).toContain(
			"── w2 Terminal (minimized) · cwd /notes · last: $ ls (exit 0)",
		);
	});

	it("names what is on the desktop", () => {
		expect(serializeScreen(snapshot())).toContain(
			"desktop (~/Desktop): Bot.md · Memory.md",
		);
	});

	it("lists only enabled apps and says why one is unavailable", () => {
		expect(serializeScreen(snapshot())).toContain(
			"apps: Browser (unavailable: no browser here) · Files",
		);
	});

	it("puts the user's changes at the top", () => {
		const screen = serializeScreen(
			snapshot({ driver: "user", pendingUserChanges: ["ran `ls`"] }),
		);
		expect(screen).toContain("driver: user");
		expect(screen.indexOf("user changes since your last screen:")).toBeLessThan(
			screen.indexOf("── w1"),
		);
	});

	it("shows one page of a Viewer file and where it is", () => {
		const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join(
			"\n",
		);
		const screen = serializeScreen(
			snapshot({
				windows: [
					{
						id: "w3",
						app: "viewer",
						x: 0,
						y: 0,
						w: 0.5,
						h: 0.5,
						z: 13,
						minimized: false,
						maximized: false,
					},
				],
				focusedWindowId: "w3",
				viewer: {
					path: "/notes/report.pdf",
					kind: "pdf",
					size: 4096,
					text,
					loading: false,
					screenLine: 40,
				},
			}),
		);

		expect(screen).toContain("── w3 Viewer · /notes/report.pdf · pdf · 4.0 KB");
		expect(screen).toContain("  line 41");
		expect(screen).not.toContain("  line 40\n");
		expect(screen).toContain("(lines 41–80 of 100; scroll up/down to page)");
	});

	it("truncates past the budget", () => {
		const screen = serializeScreen(snapshot(), { budget: 40 });
		expect(screen).toContain("(… screen truncated");
	});
});

describe("listFileRefs", () => {
	it("has no up entry at the root", () => {
		const refs = listFileRefs({ cwd: "/", entries: [] });
		expect(refs).toEqual([{ ref: "f1", target: { kind: "new-file" } }]);
	});
});
