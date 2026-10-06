import { describe, expect, it } from "vitest";
import {
	listFileRefs,
	nextWindowScroll,
	serializeScreen,
} from "../screen-serializer";
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
	tasks: { items: [] },
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
		tabs: [
			{
				id: "1",
				cwd: "/notes",
				running: false,
				command: "ls",
				lastExitCode: 0,
			},
		],
		activeTabId: "1",
		runningTabId: null,
	},
	cursor: null,
	desktop: [
		{ name: "Bot.md", path: "/agents/guest/Bot.md", type: "file" },
		{
			name: "Memory.md",
			path: "/agents/guest/Memory.md",
			type: "file",
		},
	],
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

	it("shows pi code in front: what it does, the agent's request and its conversation", () => {
		const pi = {
			id: "w3",
			app: "pi" as const,
			x: 0,
			y: 0,
			w: 0.7,
			h: 0.8,
			z: 20,
			minimized: false,
			maximized: false,
		};
		const base = snapshot();
		const screen = serializeScreen({
			...base,
			windows: [...base.windows, pi],
			focusedWindowId: "w3",
			piCode: {
				status: "running",
				working: true,
				activity: "running bash",
				cwd: "/agents/guest/todo",
				model: "openrouter/coder",
				thinkingLevel: "medium",
				contextPercent: 12,
				earlier: 4,
				transcript: [
					{ kind: "user", text: "Build a todo API" },
					{ kind: "tool", name: "write", text: "server.js" },
					{ kind: "bash", text: "npm test → exit 1", failed: true },
					{ kind: "assistant", text: "Tests fail; fixing." },
				],
				queued: [{ mode: "followUp", text: "Add a README" }],
			},
		});
		expect(screen).toContain(
			"── w3 pi code · working: running bash · ~/todo · openrouter/coder (thinking medium) · context 12%",
		);
		expect(screen).toContain(
			[
				"conversation (4 earlier entries left out):",
				"user: Build a todo API",
				"  ✓ write server.js",
				"  ✗ ! npm test → exit 1",
				"pi: Tests fail; fixing.",
				"queued follow-up: Add a README",
				'memon_code { action: "wait" } waits for it · a prompt steers it · { action: "stop" } stops it',
			].join("\n"),
		);

		const asking = serializeScreen({
			...base,
			windows: [...base.windows, pi],
			focusedWindowId: "w3",
			piCode: {
				status: "idle",
				working: false,
				approval: { id: "p1", task: "Build a todo API", requestedAt: 0 },
			},
		});
		expect(asking).toContain(
			"── w3 pi code · waiting for the user to allow your request",
		);
		expect(asking).toContain(
			'your request waits for the user in this window: "Build a todo API"',
		);
	});

	it("names what is on the desktop", () => {
		expect(serializeScreen(snapshot())).toContain(
			"desktop (~): Bot.md · Memory.md",
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

	it("pages a folder too long for the screen, and scrolls through it", () => {
		const entries = Array.from({ length: 400 }, (_, i) => ({
			name: `file-${i + 1}.md`,
			path: `/notes/file-${i + 1}.md`,
			type: "file" as const,
			size: 10,
		}));
		const at = (scroll?: number) => {
			const base = snapshot({ files: { cwd: "/notes", entries } });
			const [files, ...rest] = base.windows;
			return { ...base, windows: [{ ...files, scroll }, ...rest] };
		};

		const first = serializeScreen(at());
		expect(first).toContain("[f1] .. (up)");
		expect(first).toContain("[f2] file-1.md · 10 B");
		expect(first).toMatch(
			/\(… \d+ more lines below — scroll down to see them\)/,
		);
		expect(first).not.toContain("file-400.md");
		expect(first).not.toContain("screen truncated");

		const down = nextWindowScroll(at(), at().windows[0], "down");
		expect(down?.moved).toBe(true);
		const second = serializeScreen(at(down?.scroll));
		expect(second).toMatch(/\(… \d+ lines above — scroll up to see them\)/);
		expect(second).not.toContain("[f1] .. (up)");

		const bottom = nextWindowScroll(at(), at().windows[0], "bottom");
		const last = serializeScreen(at(bottom?.scroll));
		expect(last).toContain("file-400.md");
		expect(last).toContain('button "New file"');
		expect(last).not.toContain("more lines below");
		expect(
			nextWindowScroll(
				at(bottom?.scroll),
				at(bottom?.scroll).windows[0],
				"down",
			),
		).toMatchObject({ moved: false });
		expect(
			nextWindowScroll(
				at(bottom?.scroll),
				at(bottom?.scroll).windows[0],
				"top",
			),
		).toEqual({ scroll: 0, moved: true });
	});

	it("scrolls the Terminal back through its output, and down to the newest", () => {
		const at = (scroll?: number) => {
			const base = snapshot();
			return {
				...base,
				focusedWindowId: "w2",
				windows: base.windows.map((window) =>
					window.id === "w2" ? { ...window, minimized: false, scroll } : window,
				),
				terminal: {
					...base.terminal,
					lines: Array.from({ length: 100 }, (_, i) => ({
						kind: "stdout" as const,
						text: `out ${i + 1}`,
					})),
				},
			};
		};
		const terminal = (scroll?: number) =>
			at(scroll).windows.find((window) => window.id === "w2") as ReturnType<
				typeof at
			>["windows"][number];

		const live = serializeScreen(at());
		expect(live).toContain("out 100");
		expect(live).toContain("out 89\n");
		expect(live).not.toContain("out 88\n");
		expect(live).toContain(
			"(… 88 earlier lines above — scroll up to see them)",
		);

		const up = nextWindowScroll(at(), terminal(), "up");
		expect(up).toEqual({ scroll: 12, moved: true });
		const earlier = serializeScreen(at(up?.scroll));
		expect(earlier).toContain("out 88\n");
		expect(earlier).not.toContain("out 89\n");
		expect(earlier).toContain(
			"(… 12 newer lines below — scroll down to see them)",
		);

		expect(nextWindowScroll(at(12), terminal(12), "down")).toEqual({
			scroll: 0,
			moved: true,
		});
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
