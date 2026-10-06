import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	WebPageOutline,
	WebSessionEvent,
} from "@/services/web-browser/web-browser-protocol";
import {
	DEFAULT_MEMON_FEATURE_CONFIG,
	type MemonFeatureConfig,
} from "../feature-config";
import type { MemonEmbeddedPort } from "../embedded-browser";
import { MemonApprovalRequiredError } from "../approval-error";
import type {
	MemonPiCodePort,
	PiCodeRunner,
} from "../apps/pi-code/pi-code-app";
import {
	MemonMachine,
	type MemonPorts,
	type MemonScheduleInput,
	normalizeBrowserUrl,
} from "../memon-machine";
import type { MemonStudioRequest } from "../studio-app";
import { runTerminalAction } from "../terminal/terminal-actions";
import type { MemonSchedule } from "../types";

const outline = (url: string, title: string): WebPageOutline => ({
	url,
	title,
	docToken: `doc-${title}`,
	blocks: [
		{ kind: "heading", level: 1, text: title },
		{ kind: "link", ref: "b1", text: "Next", href: `${url}/next` },
	],
	omittedAbove: 0,
	omittedBelow: 0,
	scroll: { y: 0, viewportHeight: 800, pageHeight: 800 },
});

const createPorts = () => {
	const files = new Map<string, string>([["/notes/a.md", "hello"]]);
	const dirs = new Set(["/", "/notes"]);
	const schedules = new Map<string, MemonSchedule>();
	const skills = new Map([
		[
			"research-writer",
			{
				description: "Write research reports with sources.",
				body: "# Research writer\n\nCite every source.",
				readOnly: false,
			},
		],
		[
			"pdf-tools",
			{
				description: "Read and split PDFs.",
				body: "Use pdf tools.",
				readOnly: true,
			},
		],
	]);
	const enabledSkills = new Set(["research-writer"]);
	const granted = new Set<string>();
	let session = 0;
	const ports: MemonPorts = {
		browser: {
			availability: () => ({ available: true }),
			open: vi.fn(async (url: string) => ({
				sessionId: `s${++session}`,
				windowId: 7,
				url,
				title: "",
			})),
			navigate: vi.fn(async (_sessionId: string, url: string) => ({
				url,
				title: "",
			})),
			outline: vi.fn(async () => outline("https://example.com", "Example")),
			act: vi.fn(async () => ({
				result: { ok: true as const, action: "click" as const, ref: "b1" },
				outline: outline("https://example.com/next", "Next"),
			})),
			history: vi.fn(async () => undefined),
			focus: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			reserve: vi.fn(() => vi.fn()),
		},
		files: {
			availability: () => ({ available: true }),
			list: vi.fn(async (dir: string) =>
				[...files.keys()]
					.filter((path) => path.startsWith(`${dir === "/" ? "" : dir}/`))
					.map((path) => ({
						name: path.split("/").pop() ?? path,
						path,
						type: "file" as const,
						size: files.get(path)?.length,
					})),
			),
			read: vi.fn(async (path: string) => {
				const content = files.get(path);
				if (content === undefined) throw new Error("ENOENT");
				return content;
			}),
			write: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
			}),
			isDirectory: vi.fn(
				async (path: string) =>
					dirs.has(path) ||
					[...files.keys()].some((file) => file.startsWith(`${path}/`)),
			),
			exists: vi.fn(async (path: string) => dirs.has(path) || files.has(path)),
			move: vi.fn(async (from: string, to: string) => {
				for (const [path, content] of [...files]) {
					if (path === from || path.startsWith(`${from}/`)) {
						files.delete(path);
						files.set(`${to}${path.slice(from.length)}`, content);
					}
				}
				if (dirs.delete(from)) dirs.add(to);
			}),
			copy: vi.fn(async (from: string, to: string) => {
				for (const [path, content] of [...files]) {
					if (path === from || path.startsWith(`${from}/`)) {
						files.set(`${to}${path.slice(from.length)}`, content);
					}
				}
				if (dirs.has(from)) dirs.add(to);
			}),
			remove: vi.fn(async (target: string) => {
				for (const path of [...files.keys()]) {
					if (path === target || path.startsWith(`${target}/`)) {
						files.delete(path);
					}
				}
				for (const dir of [...dirs]) {
					if (dir === target || dir.startsWith(`${target}/`)) dirs.delete(dir);
				}
			}),
			subscribe: vi.fn(() => () => undefined),
			zip: vi.fn(async (folder: string) => ({
				name: `${folder.split("/").pop()}.zip`,
				bytes: new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
				fileCount: [...files.keys()].filter((path) =>
					path.startsWith(`${folder}/`),
				).length,
				totalBytes: 5,
			})),
			preview: vi.fn(async (_path: string, kind: string) => ({
				text:
					kind === "pdf"
						? Array.from({ length: 90 }, (_, i) => `pdf line ${i + 1}`).join(
								"\n",
							)
						: "An image, 640×480 px.",
				size: 2048,
			})),
		},
		scheduler: {
			list: vi.fn(async () => ({
				agentName: "Researcher",
				items: [...schedules.values()],
			})),
			save: vi.fn(async (_agentId: string, input: MemonScheduleInput) => {
				const id = input.id ?? `job-${schedules.size + 1}`;
				const saved = { ...input, id };
				schedules.set(id, saved);
				return saved;
			}),
			remove: vi.fn(async (id: string) => {
				schedules.delete(id);
			}),
		},
		terminal: {
			availability: async () => ({ available: true }),
			run: vi.fn(async (command: string) => ({
				running: false,
				exitCode: 0,
				output: [{ kind: "stdout" as const, text: `ran ${command}` }],
			})),
			read: vi.fn(async () => ({ running: false, exitCode: 0, output: [] })),
			input: vi.fn(async () => undefined),
			stop: vi.fn(async () => undefined),
		},
		skills: {
			list: vi.fn(async () => ({
				agentName: "Researcher",
				items: [...skills].map(([name, skill]) => ({
					name,
					description: skill.description,
					origin: skill.readOnly ? ("default" as const) : ("custom" as const),
					readOnly: skill.readOnly,
					enabled: enabledSkills.has(name),
				})),
			})),
			read: vi.fn(async (name: string) => {
				const skill = skills.get(name);
				if (!skill) throw new Error(`no skill ${name}`);
				return {
					name,
					description: skill.description,
					body: skill.body,
					origin: skill.readOnly ? ("default" as const) : ("custom" as const),
					readOnly: skill.readOnly,
				};
			}),
			setEnabled: vi.fn(async (_agentId: string, name: string, on: boolean) => {
				if (on) enabledSkills.add(name);
				else enabledSkills.delete(name);
			}),
			save: vi.fn(
				async (skill: { name: string; description: string; body: string }) => {
					skills.set(skill.name, { ...skill, readOnly: false });
				},
			),
			remove: vi.fn(async (name: string) => {
				skills.delete(name);
			}),
		},
		connections: {
			list: vi.fn(async () => ({
				agentName: "Researcher",
				unlocked: false,
				items: [
					{
						key: "c1::gmail",
						connectionId: "c1",
						label: "Gmail",
						connectionName: "Composio",
						kind: "composio" as const,
						appId: "gmail",
						status: "connected" as const,
						granted: granted.has("c1::gmail"),
						tools: [
							{
								name: "c1__GMAIL_SEND",
								description: "Send an email",
								destructive: true,
							},
						],
					},
				],
			})),
			setGranted: vi.fn(async (_agentId: string, key: string, on: boolean) => {
				if (on) granted.add(key);
				else granted.delete(key);
			}),
			refresh: vi.fn(async () => undefined),
		},
		studio: {
			tools: vi.fn(async () => [
				{ id: "transcribe" as const, ready: true, model: "whisper-tiny" },
				{
					id: "image" as const,
					ready: false,
					reason: "no model chosen in Studio",
				},
			]),
			run: vi.fn(async (request: MemonStudioRequest) => {
				if (request.tool === "image") throw new Error("Image has no model.");
				const transcript = "hello world ".repeat(3).trim();
				return {
					input: request.path ?? "",
					text: `Transcript (en):
${transcript}`,
					fullText: `Transcript (en):
${transcript}`,
					parts: [
						{
							type: "text" as const,
							text: transcript,
							role: "transcript" as const,
						},
					],
					model: "whisper-tiny",
					conversationId: "studio-session",
					itemId: "item-1",
				};
			}),
		},
	};
	return { ports, files };
};

/** A pi that starts at once, idle, in the folder it is given. */
const fakePiCode = () => {
	const port = {
		start: vi.fn(
			async ({ cwd, home }: { cwd?: string; home: string }) =>
				({
					status: () => ({ running: false, cwd: cwd ?? home }),
					view: () => ({
						entries: [],
						earlier: 0,
						thinkingLevel: "off",
						queued: [],
					}),
					attach: () => 0,
					read: async (cursor: number) => ({ data: "", cursor, reset: false }),
					input: () => {},
					pasteImage: async () => {},
					resize: () => {},
					submit: async () => {},
					interrupt: async () => {},
					newSession: async () => {},
					compact: async () => {},
					waitForIdle: async () => true,
					dispose: async () => {},
				}) satisfies PiCodeRunner,
		),
		folders: vi.fn(async () => []),
	};
	return port as typeof port & MemonPiCodePort;
};

const createMachine = (config: Partial<MemonFeatureConfig> = {}) => {
	const { ports, files } = createPorts();
	const machine = new MemonMachine("conversation-1", ports, {
		...DEFAULT_MEMON_FEATURE_CONFIG,
		...config,
	});
	return { machine, ports, files };
};

describe("MemonMachine", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens pages in one browser window and reserves each tab session", async () => {
		const { machine, ports } = createMachine();

		await machine.openUrl("example.com");
		await machine.openUrl("https://example.com/other", { newTab: true });

		expect(ports.browser.open).toHaveBeenNthCalledWith(
			1,
			"https://example.com",
			{
				windowId: undefined,
			},
		);
		// The second tab joins the first tab's window.
		expect(ports.browser.open).toHaveBeenNthCalledWith(
			2,
			"https://example.com/other",
			{ windowId: 7 },
		);
		expect(ports.browser.reserve).toHaveBeenCalledTimes(2);
		const screen = machine.readScreen();
		expect(screen).toContain("── w1 Browser · tab 2 of 2");
		expect(screen).toContain('[b1] link "Next"');
	});

	it("waits for an opened page to draw itself, and syncs it again on a read", async () => {
		const { machine, ports } = createMachine();
		const settle = vi.fn(
			async (_sessionId: string, _options: { timeoutMs: number }) =>
				outline("https://example.com", "Example"),
		);
		ports.browser.settle = settle;

		await machine.openUrl("https://example.com");
		await machine.openUrl("https://example.com/inbox");
		expect(ports.browser.navigate).toHaveBeenCalledWith(
			"s1",
			"https://example.com/inbox",
		);
		// A new tab and the same tab both wait the same way.
		expect(settle).toHaveBeenNthCalledWith(1, "s1", { timeoutMs: 10_000 });
		expect(settle).toHaveBeenNthCalledWith(2, "s1", { timeoutMs: 10_000 });
		expect(ports.browser.outline).not.toHaveBeenCalled();

		// The page moved on in the real tab: a read brings the tab up to date.
		settle.mockResolvedValueOnce({
			...outline("https://example.com/inbox/42", "Message"),
			busy: true,
		});
		await machine.refreshBrowser();
		expect(settle).toHaveBeenLastCalledWith("s1", { timeoutMs: 3_000 });
		const screen = machine.readScreen();
		expect(screen).toContain("url: https://example.com/inbox/42");
		expect(screen).toContain("title: Message");
		expect(screen).toContain("(the page was still loading when read");
	});

	it("follows what the user does in the real tab, and tells the agent", async () => {
		const { machine, ports } = createMachine();
		let report: (event: WebSessionEvent) => void = () => undefined;
		const unwatch = vi.fn();
		ports.browser.watch = vi.fn((_sessionId, listener) => {
			report = listener;
			return unwatch;
		});
		await machine.openUrl("https://example.com");
		expect(ports.browser.watch).toHaveBeenCalledWith(
			"s1",
			expect.any(Function),
		);
		machine.readScreen();
		vi.mocked(ports.browser.outline).mockClear();
		vi.mocked(ports.browser.outline).mockResolvedValue(
			outline("https://example.com/next", "Next"),
		);

		// A click and the navigation it starts: one re-read for both.
		report({
			kind: "clicked",
			target: 'link "Next"',
			href: "https://example.com/next",
		});
		report({
			kind: "navigated",
			url: "https://example.com/next",
			reload: false,
		});
		await vi.advanceTimersByTimeAsync(300);
		expect(ports.browser.outline).toHaveBeenCalledTimes(1);
		const screen = machine.readScreen();
		expect(screen).toContain('- clicked link "Next" in the real tab');
		expect(screen).toContain(
			"- went to https://example.com/next in the real tab",
		);
		expect(screen).toContain("url: https://example.com/next");
		// Followed by the user, so the computer was not taken over.
		expect(machine.snapshot().driver).toBe("agent");

		// Where the tab already is: nothing new to say.
		report({
			kind: "navigated",
			url: "https://example.com/next/",
			reload: false,
		});
		await vi.advanceTimersByTimeAsync(300);
		expect(machine.readScreen()).not.toContain("user changes");

		report({ kind: "closed" });
		await vi.advanceTimersByTimeAsync(0);
		expect(machine.readScreen()).toContain(
			"- closed the real tab (https://example.com/next)",
		);
		expect(machine.snapshot().browser.tabs).toHaveLength(0);
		expect(unwatch).toHaveBeenCalled();
	});

	it("reads a tab behind the front one only when it comes to the front", async () => {
		const { machine, ports } = createMachine();
		const reports = new Map<string, (event: WebSessionEvent) => void>();
		ports.browser.watch = vi.fn((sessionId, listener) => {
			reports.set(sessionId, listener);
			return vi.fn();
		});
		let pageB = "https://b.example";
		const settle = vi.fn(
			async (_sessionId: string, _options: { timeoutMs: number }) =>
				outline(pageB, "B"),
		);
		ports.browser.settle = settle;
		await machine.openUrl("https://a.example");
		await machine.openUrl("https://b.example", { newTab: true });
		await machine.selectTab(1);
		machine.readScreen();
		settle.mockClear();
		vi.mocked(ports.browser.outline).mockClear();

		// The user works in tab 2 while tab 1 is in front.
		pageB = "https://b.example/cart";
		reports.get("s2")?.({
			kind: "navigated",
			url: "https://b.example/cart",
			reload: false,
		});
		await vi.advanceTimersByTimeAsync(1_000);
		expect(settle).not.toHaveBeenCalled();
		expect(ports.browser.outline).not.toHaveBeenCalled();
		expect(machine.readScreen()).toContain(
			"- went to https://b.example/cart in real tab 2",
		);

		// Switching to it reads it, waiting for its page to settle.
		await machine.selectTab(2);
		expect(settle).toHaveBeenCalledWith("s2", { timeoutMs: 3_000 });
		expect(machine.readScreen()).toContain("url: https://b.example/cart");

		// Unchanged since: switching back and forth just reads it.
		await machine.selectTab(1);
		await machine.selectTab(2);
		expect(settle).toHaveBeenCalledTimes(1);
	});

	it("stops the agent at a verification wall until the user gets the page through", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.browser.outline).mockResolvedValue({
			...outline("https://shop.test/", "Just a moment..."),
			blocks: [
				{
					kind: "text",
					text: "Verifying you are human. Performance & security by Cloudflare",
				},
			],
		});

		// The agent opens the page and stops there.
		await machine.runAgentAction("Opening", {}, () =>
			machine.openUrl("https://shop.test/"),
		);
		expect(machine.snapshot().driver).toBe("user");
		expect(machine.snapshot().browser.wallTabId).toBe("tab1");
		const screen = machine.readScreen();
		expect(screen).toContain(
			"blocked: The site served a Cloudflare verification page",
		);
		expect(screen).toContain("your next action waits until they have");
		let turn: string | undefined;
		void machine.waitForAgentTurn().then((outcome) => {
			turn = outcome;
		});
		await vi.advanceTimersByTimeAsync(1_000);
		expect(turn).toBeUndefined();

		// Done, but the page still asks: the agent keeps waiting.
		await machine.recheckWall();
		await vi.advanceTimersByTimeAsync(0);
		expect(turn).toBeUndefined();

		// Through: the agent goes on by itself.
		vi.mocked(ports.browser.outline).mockResolvedValue(
			outline("https://shop.test/", "Shop"),
		);
		await machine.recheckWall();
		await vi.advanceTimersByTimeAsync(0);
		expect(turn).toBe("ready");
		expect(machine.snapshot().browser.wallTabId).toBeUndefined();
		expect(machine.readScreen()).toContain(
			"- got https://shop.test/ past its verification",
		);
	});

	it("leaves the user's own browsing alone, and a wall the user waves through", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.browser.outline).mockResolvedValue({
			...outline("https://shop.test/", "Security check"),
			blocks: [{ kind: "text", text: "Please verify you are human." }],
		});

		// The user opens it: nothing to stop.
		await machine.openUrl("https://shop.test/");
		expect(machine.snapshot().driver).toBe("agent");
		expect(machine.snapshot().browser.tabs[0].wall?.kind).toBe("captcha");
		expect(machine.readScreen()).toContain("Only a person can get past it");

		await machine.runAgentAction("Reading", {}, () => machine.refreshBrowser());
		expect(machine.snapshot().driver).toBe("user");

		// A false alarm: the user lets the agent go on, and it is not stopped
		// on that page again.
		machine.continuePastWall();
		expect(machine.snapshot().driver).toBe("agent");
		await machine.runAgentAction("Reading", {}, () => machine.refreshBrowser());
		expect(machine.snapshot().driver).toBe("agent");
		expect(machine.snapshot().browser.tabs[0].wall).toBeUndefined();
	});

	it("acts with the page the agent read, not one the machine read since", async () => {
		const { machine, ports } = createMachine();
		await machine.openUrl("https://example.com");
		machine.readScreen();
		// The page changed and was read again without the agent seeing it.
		vi.mocked(ports.browser.outline).mockResolvedValue(
			outline("https://example.com/other", "Other"),
		);
		await machine.refreshBrowser();

		const pending = machine.browserAction({ ref: "b1", action: "click" });
		await vi.runAllTimersAsync();
		await pending;

		// The page refuses the old ref as stale instead of clicking another b1.
		expect(ports.browser.act).toHaveBeenLastCalledWith(
			"s1",
			expect.objectContaining({ docToken: "doc-Example" }),
		);
	});

	it("turns plain words into a search", async () => {
		const { machine, ports } = createMachine();
		await machine.openUrl("agent quality improvement");
		expect(ports.browser.open).toHaveBeenCalledWith(
			"https://duckduckgo.com/?q=agent%20quality%20improvement",
			{ windowId: undefined },
		);
	});

	it("acts on a ref with the token it was read with", async () => {
		const { machine, ports } = createMachine();
		await machine.openUrl("https://example.com");

		const pending = machine.browserAction({ ref: "b1", action: "click" });
		await vi.runAllTimersAsync();
		await pending;

		expect(ports.browser.act).toHaveBeenCalledWith("s1", {
			ref: "b1",
			action: "click",
			docToken: "doc-Example",
			allowFormSubmit: false,
		});
	});

	it("turns a gated form submission into an approval request", async () => {
		const { machine, ports } = createMachine();
		await machine.openUrl("https://example.com");
		vi.mocked(ports.browser.act).mockResolvedValueOnce({
			result: {
				ok: false,
				action: "click",
				ref: "b1",
				needsApproval: "form-submit",
				detail: "This click submits a form.",
			},
		});

		await expect(
			machine.browserAction({ ref: "b1", action: "click" }),
		).rejects.toBeInstanceOf(MemonApprovalRequiredError);
	});

	it("parks tool calls while the user drives and releases them on resume", async () => {
		const { machine } = createMachine();
		machine.beginRun("chat:1");
		machine.takeOver();

		let outcome: string | undefined;
		void machine.waitForAgentTurn().then((value) => {
			outcome = value;
		});
		await vi.advanceTimersByTimeAsync(1_000);
		expect(outcome).toBeUndefined();

		machine.resume();
		await vi.advanceTimersByTimeAsync(0);
		expect(outcome).toBe("ready");
	});

	it("gives up waiting at the ceiling and when the user stops the run", async () => {
		const { machine } = createMachine();
		machine.takeOver();

		const timedOut = machine.waitForAgentTurn(5_000);
		await vi.advanceTimersByTimeAsync(5_000);
		await expect(timedOut).resolves.toBe("timeout");

		const cancelled = machine.waitForAgentTurn(5_000);
		machine.cancelWaits();
		await expect(cancelled).resolves.toBe("cancelled");
	});

	it("hands the computer back when a new run starts", async () => {
		const { machine } = createMachine();
		machine.beginRun("chat:1");
		machine.takeOver();

		machine.beginRun("chat:1");
		expect(machine.currentDriver).toBe("user");

		machine.beginRun("chat:2");
		expect(machine.currentDriver).toBe("agent");
	});

	it("reports user changes once, on the agent's next read", async () => {
		const { machine } = createMachine();
		machine.noteUserChange("went to https://example.com");

		const first = machine.readScreen();
		expect(first).toContain("user changes since your last screen:");
		expect(first).toContain("- went to https://example.com");
		expect(machine.readScreen()).not.toContain("user changes");
	});

	it("keeps the terminal working directory across commands", async () => {
		const { machine, ports } = createMachine();

		await machine.terminal.runCommand("cd /notes");
		expect(ports.terminal.run).not.toHaveBeenCalled();
		await machine.terminal.runCommand("ls");

		expect(ports.terminal.run).toHaveBeenCalledWith("ls", {
			cwd: "/notes",
			waitMs: 400,
			sessionKey: "conversation-1",
		});
	});

	it("runs a cd chained with another command in the sandbox shell", async () => {
		const { machine, ports } = createMachine();

		await machine.terminal.runCommand(
			"cd /notes/landing-page && node server.js",
		);

		// Tabs start in the agent's home.
		expect(ports.terminal.run).toHaveBeenCalledWith(
			"cd /notes/landing-page && node server.js",
			{ cwd: "/agents/guest", waitMs: 400, sessionKey: "conversation-1" },
		);
	});

	it("goes home with cd and ~, and expands ~ in commands", async () => {
		const { machine, ports, files } = createMachine();
		machine.setAgent("agent-1", "/agents/Research Bot");
		files.set("/agents/Research Bot/site/index.html", "<p>hi</p>");

		await machine.terminal.runCommand("cd /notes");
		await machine.terminal.runCommand("cd");
		expect(machine.snapshot().terminal.cwd).toBe("/agents/Research Bot");
		await machine.terminal.runCommand("cd ~/site");
		expect(machine.snapshot().terminal.cwd).toBe("/agents/Research Bot/site");

		await machine.terminal.runCommand("cat ~/site/index.html '~/x' && ls ~");
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"cat '/agents/Research Bot'/site/index.html '~/x' && ls '/agents/Research Bot'",
			expect.objectContaining({ cwd: "/agents/Research Bot/site" }),
		);
		// The tab shows the line as it was typed.
		expect(machine.snapshot().terminal.lines.at(-2)?.text).toBe(
			"cat ~/site/index.html '~/x' && ls ~",
		);
	});

	it("keeps the command history in ~/.terminal_history, with clear and history", async () => {
		const { machine, files: stored } = createMachine();
		await machine.prepareDesktop();
		await machine.terminal.runCommand("ls");
		await machine.terminal.runCommand("ls");
		await machine.terminal.runCommand("node app.js");
		await machine.flushWrites();
		// One command per line, like ~/.bash_history; hidden from the desktop.
		expect(stored.get("/agents/guest/.terminal_history")).toBe(
			"ls\nnode app.js\n",
		);
		expect(machine.snapshot().terminal.historyPath).toBe(
			"/agents/guest/.terminal_history",
		);

		await machine.terminal.runCommand("history");
		expect(
			machine
				.snapshot()
				.terminal.lines.slice(-3)
				.map((line) => line.text),
		).toEqual(["  1  ls", "  2  node app.js", "  3  history"]);
		await machine.terminal.runCommand("clear");
		expect(machine.snapshot().terminal.lines).toEqual([]);
		await machine.flushWrites();

		// Another computer of the agent's reads it back.
		const { machine: next, files: nextFiles } = createMachine();
		nextFiles.set(
			"/agents/guest/.terminal_history",
			stored.get("/agents/guest/.terminal_history") ?? "",
		);
		await next.prepareDesktop();
		expect(next.snapshot().terminal.history).toEqual([
			"ls",
			"node app.js",
			"history",
			"clear",
		]);

		machine.clearTerminalHistory();
		await machine.flushWrites();
		expect(machine.snapshot().terminal.history).toEqual([]);
		expect(stored.get("/agents/guest/.terminal_history")).toBe("");
	});

	it("completes on Tab: a command by name, anything else from the tab's folder", async () => {
		const { machine, ports } = createMachine();
		machine.setAgent("agent-1", "/agents/Research Bot");
		vi.mocked(ports.files.list).mockImplementation(async (dir: string) =>
			dir === "/agents/Research Bot"
				? [
						{ name: "site", path: `${dir}/site`, type: "dir" as const },
						{
							name: "notes.md",
							path: `${dir}/notes.md`,
							type: "file" as const,
						},
					]
				: [],
		);
		expect(await machine.terminal.complete("cat no")).toEqual({
			line: "cat notes.md ",
			suggestions: [],
		});
		expect((await machine.terminal.complete("cd ~/s")).line).toBe("cd ~/site/");
		expect((await machine.terminal.complete("hist")).line).toBe("history ");
		// Nothing by that name: lines run before that start with it.
		await machine.terminal.runCommand("git status");
		expect((await machine.terminal.complete("git st")).line).toBe("git status");
		expect(ports.files.list).toHaveBeenCalledWith("/agents/Research Bot");
	});

	it("says where the tab's lines start, and clears its screen on Ctrl+L", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			running: false,
			exitCode: 0,
			output: Array.from({ length: 450 }, (_, index) => ({
				kind: "stdout" as const,
				text: `line ${index}`,
			})),
		});
		await machine.terminal.runCommand("seq 450");
		const before = machine.snapshot().terminal;
		// The command's line and 450 of output: the latest 400 are kept.
		expect(before.lineOffset).toBe(51);
		expect(before.lines[0]?.text).toBe("line 50");

		machine.terminal.clearTab();
		const after = machine.snapshot().terminal;
		expect(after.lines).toEqual([]);
		expect(after.lineOffset).toBe(0);
		expect(after.screenId).not.toBe(before.screenId);
		// Unlike `clear`, Ctrl+L is no command in the history.
		expect(after.history).toEqual(["seq 450"]);
	});

	it("counts the address a running command prints as a server", async () => {
		const { machine, ports } = createMachine();
		let stopped = false;
		let reads = 0;
		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			processId: "p1",
			running: true,
			exitCode: null,
			output: [
				{
					kind: "stdout",
					text: "Landing page server dang chay tai http://localhost:3000",
				},
			],
		});
		vi.mocked(ports.terminal.read).mockImplementation(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			reads += 1;
			return {
				processId: "p1",
				running: !stopped,
				exitCode: stopped ? 0 : null,
				output:
					reads === 1
						? [{ kind: "stdout" as const, text: "listening on 8080" }]
						: [],
			};
		});
		vi.mocked(ports.terminal.stop).mockImplementation(async () => {
			stopped = true;
		});

		const run = machine.terminal.runCommand("node server.js", { waitMs: 500 });
		await vi.advanceTimersByTimeAsync(600);
		await run;
		expect(machine.terminal.servers).toEqual([3000]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(machine.snapshot().terminal.servers).toEqual([3000, 8080]);
		expect(machine.readScreen()).toContain(
			"serving http://localhost:3000, http://localhost:8080",
		);

		const stop = machine.terminal.stopCommand();
		await vi.advanceTimersByTimeAsync(3_100);
		await stop;
		expect(machine.terminal.servers).toEqual([]);
	});

	it("lets go of a command the sandbox no longer has, or that will not stop", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			processId: "gone",
			running: true,
			exitCode: null,
			output: [],
		});
		await machine.terminal.runCommand("node stuck.js", { waitMs: 0 });
		expect(machine.terminal.running?.command).toBe("node stuck.js");
		vi.mocked(ports.terminal.stop).mockRejectedValueOnce(
			new Error("Unknown process: gone"),
		);
		await machine.terminal.stopCommand();
		expect(machine.terminal.running).toBeNull();
		expect(machine.snapshot().terminal.lastExitCode).toBe(130);

		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			processId: "p2",
			running: true,
			exitCode: null,
			output: [],
		});
		await machine.terminal.runCommand("node stuck.js", { waitMs: 0 });
		const stop = machine.terminal.stopCommand();
		await vi.advanceTimersByTimeAsync(3_100);
		await stop;
		expect(machine.terminal.running).toBeNull();
		expect(machine.snapshot().terminal.lines.at(-1)?.text).toContain(
			"the Terminal let it go",
		);
	});

	it("downloads a web file into Files in one step, without overwriting", async () => {
		const { machine, ports, files } = createMachine();
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		ports.download = {
			fetch: vi.fn(async (url: string) => ({
				bytes,
				contentType: "image/png; charset=binary",
				url,
			})),
		};

		const first = await machine.downloadFile(
			"https://cdn.example.com/img/hero",
		);
		expect(first).toEqual({
			path: `${machine.home}/Downloads/hero.png`,
			size: 4,
			type: "image/png",
		});
		expect(files.get(first.path)).toBe(bytes);
		// A second copy gets a new name; nothing is overwritten.
		expect(
			(await machine.downloadFile("https://cdn.example.com/img/hero")).path,
		).toBe(`${machine.home}/Downloads/hero 2.png`);
		expect(
			(
				await machine.downloadFile(
					"https://cdn.example.com/a.png",
					"/notes/site/assets/logo.png",
				)
			).path,
		).toBe("/notes/site/assets/logo.png");
		expect(
			(await machine.downloadFile("https://cdn.example.com/a.png", "/notes/"))
				.path,
		).toBe("/notes/a.png");

		await expect(
			machine.downloadFile("data:image/png;base64,AAAA"),
		).rejects.toThrow("inline in the page");
		await expect(
			machine.downloadFile("http://localhost:3000/a.png"),
		).rejects.toThrow("is a server in this computer");
		await expect(machine.downloadFile("hero.png")).rejects.toThrow(
			"full http(s) address",
		);
	});

	it("keeps each Terminal tab's directory and output, with one long command at a time", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			processId: "server",
			running: true,
			exitCode: null,
			output: [{ kind: "stdout", text: "listening on 3000" }],
		});
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		await machine.terminal.runCommand("node server.js", { waitMs: 0 });

		const second = machine.terminal.openTab();
		expect(second).toBe("2");
		expect(machine.snapshot().terminal).toMatchObject({
			activeTabId: "2",
			runningTabId: "1",
			lines: [],
			tabs: [
				{ id: "1", cwd: "/agents/guest", running: true },
				{ id: "2", cwd: "/agents/guest", running: false },
			],
		});

		await machine.terminal.runCommand("cd /notes");
		await expect(machine.terminal.runCommand("ls")).resolves.toMatchObject({
			alongside: true,
			exitCode: 0,
		});
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"ls",
			expect.objectContaining({ cwd: "/notes" }),
		);
		const tab2 = machine.snapshot().terminal;
		expect(tab2.cwd).toBe("/notes");
		expect(tab2.lines.map((line) => line.text)).toEqual([
			"cd /notes",
			"ls",
			"ran ls",
		]);
		expect(machine.readScreen()).toContain("tab 1 is running `node server.js`");
		// The running tab says the port it serves, so the agent uses that
		// server instead of starting another.
		expect(machine.readScreen()).toMatch(
			/1 .+ · running `node server\.js` for .+ · serving http:\/\/localhost:3000/,
		);
		// A command that finishes runs next to the server, in its own tab.
		await expect(
			machine.terminal.runCommand("npm test"),
		).resolves.toMatchObject({ alongside: true, exitCode: 0 });
		expect(machine.terminal.running?.command).toBe("node server.js");
		// So does the Terminal's line when another window is in front.
		machine.focusWindow(machine.openWindow("editor").id);
		expect(machine.readScreen()).toMatch(
			/Terminal.* · tab 1 running `node server\.js` for \S+ · serving http:\/\/localhost:3000/,
		);

		// The server's tab kept its own directory and output.
		machine.terminal.selectTab("1");
		expect(machine.snapshot().terminal).toMatchObject({ cwd: "/agents/guest" });
		expect(machine.snapshot().terminal.lines.map((line) => line.text)).toEqual([
			"node server.js",
			"listening on 3000",
		]);

		// Closing the server's tab stops it; the other tab comes to the front.
		const close = machine.terminal.closeTab("1");
		await vi.advanceTimersByTimeAsync(3_100);
		await close;
		expect(ports.terminal.stop).toHaveBeenCalledWith(
			"server",
			"conversation-1",
		);
		expect(machine.terminal.running).toBeNull();
		expect(machine.snapshot().terminal).toMatchObject({
			activeTabId: "2",
			runningTabId: null,
			tabs: [{ id: "2", cwd: "/notes", running: false }],
		});
		await machine.terminal.runCommand("npm test");
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"npm test",
			expect.objectContaining({ cwd: "/notes" }),
		);
	});

	it("lets the agent open, switch, read and close Terminal tabs with memon_run", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			processId: "server",
			running: true,
			exitCode: null,
			output: [{ kind: "stdout", text: "listening on 3000" }],
		});
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		await machine.terminal.runCommand("node server.js", { waitMs: 0 });

		await expect(
			runTerminalAction(machine.terminal, { command: "ls", terminal: "new" }),
		).resolves.toContain("(Terminal tab 1), which keeps running");
		expect(machine.terminal.activeTabId).toBe("2");
		// The server's output stays on screen while tab 2 is in front, and
		// every tab says what runs in it or what it ran last.
		const screen = machine.readScreen();
		expect(screen).toContain("tab 1's latest output");
		expect(screen).toContain("  | listening on 3000");
		expect(screen).toContain("Terminal · tab 2 of 2 · cwd ~");
		expect(screen).toContain("  1  ~ · running `node server.js` for 0s");
		expect(screen).toContain("  2* ~ · last: $ ls (exit 0)");
		expect(machine.snapshot().terminal.tabs).toMatchObject([
			{ id: "1", running: true, command: "node server.js", lastExitCode: null },
			{ id: "2", running: false, command: "ls", lastExitCode: 0 },
		]);

		await expect(
			runTerminalAction(machine.terminal, { terminal: "2", stop: true }),
		).rejects.toThrow("Nothing runs in Terminal tab 2");
		await expect(
			runTerminalAction(machine.terminal, { terminal: "1" }),
		).resolves.toContain("Terminal tab 1 is in front.");
		expect(machine.snapshot().terminal.lines.map((line) => line.text)).toEqual([
			"node server.js",
			"listening on 3000",
		]);
		expect(machine.readScreen()).not.toContain("latest output");

		await expect(
			runTerminalAction(machine.terminal, { terminal: "2", closeTab: true }),
		).resolves.toContain("Closed Terminal tab 2; tab 1 is in front.");
		expect(machine.snapshot().terminal.tabs.map((tab) => tab.id)).toEqual([
			"1",
		]);
		expect(machine.terminal.running?.command).toBe("node server.js");
	});

	it("tells the agent each tab's earlier commands, and where a command ran", async () => {
		const { machine } = createMachine();
		await expect(
			runTerminalAction(machine.terminal, { command: "ls" }),
		).resolves.toBe("Ran `ls` in Terminal tab 1 (exit 0).");
		await runTerminalAction(machine.terminal, { command: "git status" });
		await runTerminalAction(machine.terminal, {
			command: "npm test",
			terminal: "new",
		});
		expect(machine.snapshot().terminal.tabs[0]?.recent).toEqual([
			"ls",
			"git status",
		]);
		const screen = machine.readScreen();
		expect(screen).toContain(
			"  1  ~ · last: $ git status (exit 0) · before: ls",
		);
		expect(screen).toContain("  2* ~ · last: $ npm test (exit 0)");
	});

	it("runs any command that finishes next to a running server", async () => {
		const { machine, ports } = createMachine();
		vi.mocked(ports.terminal.run)
			.mockResolvedValueOnce({
				processId: "server",
				running: true,
				exitCode: null,
				output: [{ kind: "stdout", text: "listening on 3000" }],
			})
			.mockResolvedValueOnce({
				running: false,
				exitCode: 0,
				output: [{ kind: "stdout", text: '{"ok":true}' }],
			})
			.mockResolvedValueOnce({
				running: false,
				exitCode: 0,
				output: [{ kind: "stdout", text: "server.js" }],
			})
			.mockResolvedValueOnce({
				running: false,
				exitCode: 0,
				output: [{ kind: "stdout", text: "/" }],
			});
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		await machine.terminal.runCommand("node server.js", { waitMs: 0 });
		expect(machine.terminal.running?.command).toBe("node server.js");

		const outcome = await machine.terminal.runCommand(
			"curl -s localhost:3000/api",
		);
		expect(outcome).toMatchObject({ alongside: true, exitCode: 0 });
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"curl -s localhost:3000/api",
			expect.objectContaining({ cwd: "/agents/guest" }),
		);
		expect(machine.terminal.running?.command).toBe("node server.js");
		expect(
			machine.snapshot().terminal.lines.map((line) => line.text),
		).toContain('{"ok":true}');

		await expect(
			machine.terminal.runCommand("ls -la | grep js"),
		).resolves.toMatchObject({ alongside: true, exitCode: 0 });
		expect(machine.terminal.running?.command).toBe("node server.js");
		expect(
			machine.snapshot().terminal.lines.map((line) => line.text),
		).toContain("server.js");

		// The user's input line: a shell tool runs, anything else is stdin.
		await machine.terminal.enterLine("pwd");
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"pwd",
			expect.objectContaining({ cwd: "/agents/guest" }),
		);
		await machine.terminal.enterLine("y");
		expect(ports.terminal.input).toHaveBeenCalledWith(
			"server",
			"y",
			"conversation-1",
		);

		// node runs next to it too: each sandbox command has its own streams.
		await expect(
			machine.terminal.runCommand("node --check other.js"),
		).resolves.toMatchObject({ alongside: true, exitCode: 0 });
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"node --check other.js",
			expect.objectContaining({ cwd: "/agents/guest" }),
		);
		expect(machine.terminal.running?.command).toBe("node server.js");
	});

	it("stops a command that keeps running next to another, and closes its servers", async () => {
		const { ports } = createPorts();
		const listening = new Set([3000]);
		const stopServer = vi.fn(async (port: number) => {
			listening.delete(port);
		});
		ports.embedded = {
			servers: vi.fn(async () => [...listening].sort()),
			stopServer,
		} as unknown as MemonEmbeddedPort;
		vi.mocked(ports.terminal.run)
			.mockResolvedValueOnce({
				processId: "server",
				running: true,
				exitCode: null,
				output: [{ kind: "stdout", text: "listening on 3000" }],
			})
			.mockImplementationOnce(async () => {
				listening.add(4000);
				return {
					processId: "watch",
					running: true,
					exitCode: null,
					output: [{ kind: "stdout", text: "watching" }],
				};
			});
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		const machine = new MemonMachine(
			"conversation-1",
			ports,
			DEFAULT_MEMON_FEATURE_CONFIG,
		);
		await machine.terminal.runCommand("node server.js", { waitMs: 0 });

		await expect(
			machine.terminal.runCommand("node watch.js"),
		).resolves.toMatchObject({ alongside: true, exitCode: 124 });
		expect(ports.terminal.stop).toHaveBeenCalledWith("watch", "conversation-1");
		expect(stopServer).toHaveBeenCalledTimes(1);
		expect(stopServer).toHaveBeenCalledWith(4000);
		expect([...listening]).toEqual([3000]);
		expect(
			machine
				.snapshot()
				.terminal.lines.slice(-2)
				.map((line) => line.text),
		).toEqual([
			"Stopped after 60s: a command next to a running one must finish.",
			"Closed localhost:4000.",
		]);
		expect(machine.terminal.running?.command).toBe("node server.js");
	});

	it("puts the agent's install in front of the user and runs it once approved", async () => {
		const { machine, ports } = createMachine();

		const run = machine.terminal.runCommand("npm install zod");
		await vi.advanceTimersByTimeAsync(0);
		const approval = machine.snapshot().terminal.approval;
		expect(approval).toMatchObject({
			command: "npm install zod",
			gate: "installs",
			agentWaiting: true,
		});
		expect(machine.readScreen()).toContain(
			"waiting for the user's approval: $ npm install zod",
		);
		expect(ports.terminal.run).not.toHaveBeenCalled();

		await machine.terminal.answerApproval(approval!.id, "approve");
		await expect(run).resolves.toMatchObject({ running: false, exitCode: 0 });
		expect(ports.terminal.run).toHaveBeenCalledTimes(1);
		expect(machine.snapshot().terminal.approval).toBeNull();
	});

	it("tells the agent when the user declines, waits, or stops the run", async () => {
		const { machine, ports } = createMachine({
			askBefore: { forms: true, installs: true, deletes: true },
		});

		const declined = machine.terminal.runCommand("rm -rf /notes", {});
		const declinedResult = expect(declined).rejects.toThrow(
			"The user declined to run `rm -rf /notes`.",
		);
		await vi.advanceTimersByTimeAsync(0);
		await machine.terminal.answerApproval(
			machine.snapshot().terminal.approval!.id,
			"deny",
		);
		await declinedResult;
		expect(machine.snapshot().terminal.approval).toBeNull();

		// Unanswered, the request stays for the user to run later.
		const unanswered = machine.terminal.runCommand("npm install zod");
		const unansweredResult = expect(unanswered).rejects.toBeInstanceOf(
			MemonApprovalRequiredError,
		);
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		await unansweredResult;
		const waiting = machine.snapshot().terminal.approval;
		expect(waiting).toMatchObject({ agentWaiting: false });
		await machine.terminal.answerApproval(waiting!.id, "approve");
		expect(ports.terminal.run).toHaveBeenCalledWith(
			"npm install zod",
			expect.objectContaining({ cwd: "/agents/guest" }),
		);

		const stopped = machine.terminal.runCommand("npm install lodash");
		const stoppedResult = expect(stopped).rejects.toThrow(
			"The user stopped the run before answering.",
		);
		await vi.advanceTimersByTimeAsync(0);
		machine.cancelWaits();
		await stoppedResult;
	});

	it("streams a long command's output, takes input, and stops it", async () => {
		const { machine, ports } = createMachine();
		const queue: Array<{
			running: boolean;
			exitCode: number | null;
			output: Array<{ kind: "stdout"; text: string }>;
		}> = [];
		ports.terminal.run = vi.fn(async () => ({
			processId: "p1",
			running: true,
			exitCode: null,
			output: [{ kind: "stdout" as const, text: "fetching" }],
			cursor: "1",
		}));
		ports.terminal.read = vi.fn(
			async (
				_processId: string,
				_cursor: string | undefined,
				_key: string,
				waitMs = 0,
			) => {
				const next = queue.shift();
				if (next) return next;
				await new Promise((resolve) => setTimeout(resolve, waitMs));
				return { running: true, exitCode: null, output: [] };
			},
		);
		ports.terminal.stop = vi.fn(async () => {
			queue.push({ running: false, exitCode: 130, output: [] });
		});

		const run = machine.terminal.runCommand("npm install -g pkg", {
			byUser: true,
			waitMs: 2_000,
		});
		// Running from the moment it starts, before any output.
		expect(machine.snapshot().terminal.runningCommand).toBe(
			"npm install -g pkg",
		);
		queue.push({
			running: true,
			exitCode: null,
			output: [{ kind: "stdout", text: "Ok to proceed? (y)" }],
		});
		await vi.advanceTimersByTimeAsync(2_500);
		await expect(run).resolves.toMatchObject({ running: true });
		expect(machine.readScreen()).toMatch(
			/running `npm install -g pkg` for \d+s/,
		);
		expect(machine.snapshot().terminal.lines.map((line) => line.text)).toEqual(
			expect.arrayContaining(["fetching", "Ok to proceed? (y)"]),
		);
		// Another command runs next to it, and the first keeps its input.
		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			running: false,
			exitCode: 0,
			output: [{ kind: "stdout", text: "built" }],
		});
		await expect(
			machine.terminal.runCommand("npm run build", { byUser: true }),
		).resolves.toMatchObject({ alongside: true, exitCode: 0 });
		expect(machine.terminal.running?.command).toBe("npm install -g pkg");

		await machine.terminal.sendInput("y");
		expect(ports.terminal.input).toHaveBeenCalledWith(
			"p1",
			"y",
			"conversation-1",
		);
		expect(machine.readScreen()).toContain("> y");

		const stop = machine.terminal.stopCommand();
		await vi.advanceTimersByTimeAsync(1_500);
		await stop;
		expect(machine.terminal.waitForCommand(10)).resolves.toBe(true);
		expect(machine.snapshot().terminal).toMatchObject({
			runningCommand: null,
			lastExitCode: 130,
		});
		expect(machine.snapshot().terminal.lines.at(-1)?.text).toBe("^C");
	});

	it("opens, edits and saves a file through the Files refs", async () => {
		const { machine, files } = createMachine();
		await machine.openFolder("/notes");

		const screen = machine.readScreen();
		expect(screen).toContain("[f1] .. (up)");
		expect(screen).toContain("[f2] a.md");

		await machine.openFileRef("f2");
		machine.setEditorContent("updated");
		await machine.saveEditor();
		expect(files.get("/notes/a.md")).toBe("updated");
	});

	it("goes back through the tab's own history after an agent click", async () => {
		const { machine, ports } = createMachine();
		let current = "https://example.com";
		vi.mocked(ports.browser.outline).mockImplementation(async () =>
			outline(current, current),
		);
		vi.mocked(ports.browser.act).mockImplementation(async () => {
			current = "https://example.com/next";
			return { result: { ok: true, action: "click", ref: "b1" } };
		});
		vi.mocked(ports.browser.navigate).mockImplementation(async (_id, url) => {
			current = url;
			return { url, title: "" };
		});

		await machine.openUrl("https://example.com");
		const click = machine.browserAction({ ref: "b1", action: "click" });
		await vi.runAllTimersAsync();
		await click;
		await machine.browserHistory("back");

		// Chrome would skip the agent-reached entry; the tab's own history does not.
		expect(ports.browser.history).not.toHaveBeenCalled();
		expect(ports.browser.navigate).toHaveBeenLastCalledWith(
			"s1",
			"https://example.com",
		);
		expect(machine.snapshot().browser.tabs[0].url).toBe("https://example.com");
		await machine.browserHistory("forward");
		expect(ports.browser.navigate).toHaveBeenLastCalledWith(
			"s1",
			"https://example.com/next",
		);
	});

	it("opens a PDF in the Viewer and pages through its text", async () => {
		const { machine, ports } = createMachine();

		await machine.openFile("/notes/report.pdf");

		expect(ports.files.read).not.toHaveBeenCalled();
		expect(ports.files.preview).toHaveBeenCalledWith(
			"/notes/report.pdf",
			"pdf",
		);
		let screen = machine.readScreen();
		expect(screen).toContain("── w1 Viewer · /notes/report.pdf · pdf · 2.0 KB");
		expect(screen).toContain("  pdf line 1");
		expect(screen).toContain("(lines 1–40 of 90; scroll up/down to page)");

		expect(machine.focusedTextWindow()).toBe("viewer");
		machine.scrollText("viewer", "down");
		machine.scrollText("viewer", "down");
		screen = machine.readScreen();
		expect(screen).toContain("  pdf line 51");
		expect(screen).toContain("(lines 51–90 of 90; scroll up/down to page)");
	});

	it("pages a long folder in Files, and starts another folder at its top", async () => {
		const { machine, files } = createMachine();
		for (let i = 1; i <= 300; i += 1) files.set(`/big/file-${i}.md`, "x");
		files.set("/small/a.md", "x");

		await machine.openFolder("/big");
		expect(machine.readScreen()).toContain("more lines below");
		expect(machine.scrollWindow("down")).toEqual({ app: "files", moved: true });
		expect(machine.readScreen()).toContain("lines above — scroll up");

		await machine.openFolder("/small");
		expect(machine.snapshot().windows[0].scroll).toBeUndefined();
		expect(machine.scrollWindow("down")).toEqual({
			app: "files",
			moved: false,
		});
	});

	it("pictures an image in Files for describe, and only an image", async () => {
		const { machine, ports } = createMachine();
		const picture = vi.fn(async () => ({
			dataUrl: "data:image/png;base64,AA",
			width: 2,
			height: 1,
		}));
		(ports.files as { picture?: typeof picture }).picture = picture;

		await expect(machine.pictureOfFile("/notes/shot.png")).resolves.toEqual({
			dataUrl: "data:image/png;base64,AA",
			width: 2,
			height: 1,
		});
		expect(picture).toHaveBeenCalledWith("/notes/shot.png");
		await expect(machine.pictureOfFile("/notes/a.md")).rejects.toThrow(
			"describe looks at images (png, jpeg, gif, webp); /notes/a.md is not one.",
		);

		// The Viewer in front with an image: what describe looks at by default.
		expect(machine.viewerImage()).toBeNull();
		await machine.openFile("/notes/photo.png", { create: true });
		expect(machine.viewerImage()).toBe("/notes/photo.png");
	});

	it("opens images in the Viewer even when asked for the Editor", async () => {
		const { machine } = createMachine();

		await machine.openFile("/notes/photo.png", { create: true });

		expect(machine.snapshot().viewer).toMatchObject({
			path: "/notes/photo.png",
			kind: "image",
			text: "An image, 640×480 px.",
			loading: false,
		});
		expect(machine.findWindow("editor")).toBeUndefined();
	});

	it("gives each agent its own home with Bot.md and Memory.md, once", async () => {
		const { machine, files } = createMachine();
		// What all agents shared before homes seeds a new home, untouched.
		files.set("/Desktop/Bot.md", "Shared rules.");
		machine.setAgent("agent-1", "/agents/Researcher");

		await machine.prepareDesktop();
		expect(machine.home).toBe("/agents/Researcher");
		expect(files.get("/agents/Researcher/Bot.md")).toBe("Shared rules.");
		expect(files.get("/agents/Researcher/Memory.md")).toContain("# Memory.md");
		expect(files.get("/Desktop/Bot.md")).toBe("Shared rules.");

		files.set("/agents/Researcher/Bot.md", "Answer briefly.");
		files.set("/agents/Researcher/.cache", "hidden");
		files.set("/agents/Researcher/report.md", "# Report");
		await machine.prepareDesktop();
		expect(files.get("/agents/Researcher/Bot.md")).toBe("Answer briefly.");
		// The desktop is the whole home, hidden files left out.
		expect(machine.snapshot().desktop.map((entry) => entry.name)).toEqual([
			"Bot.md",
			"Memory.md",
			"report.md",
		]);
		expect(machine.readScreen()).toContain(
			"desktop (~): Bot.md · Memory.md · report.md",
		);
		// Files opens at home.
		await machine.openFolder("~");
		expect(machine.snapshot().files.cwd).toBe("/agents/Researcher");

		machine.setAgent("agent-2", "/agents/Writer");
		await machine.prepareDesktop();
		expect(files.get("/agents/Writer/Bot.md")).toBe("Shared rules.");
		expect(machine.snapshot().files.cwd).toBe("/agents/Writer");
		expect(machine.snapshot().terminal.cwd).toBe("/agents/Writer");
		expect(machine.readScreen()).toContain("Files · ~");
	});

	it("follows its agent's home when the agent is renamed", async () => {
		const { machine, files, ports } = createMachine();
		machine.setAgent("agent-1", "/agents/Researcher");
		await machine.prepareDesktop();
		machine.addTask({ title: "Read sources", by: "agent" });
		await machine.openFolder("~");
		await machine.terminal.runCommand("cd ~");
		await machine.flushWrites();

		await ports.files.move("/agents/Researcher", "/agents/Analyst");
		machine.setAgent("agent-1", "/agents/Analyst");
		await vi.advanceTimersByTimeAsync(0);

		expect(machine.home).toBe("/agents/Analyst");
		expect(machine.snapshot().files.cwd).toBe("/agents/Analyst");
		expect(machine.snapshot().terminal.cwd).toBe("/agents/Analyst");
		expect(machine.snapshot().tasks.items.map((task) => task.title)).toEqual([
			"Read sources",
		]);
		machine.addTask({ title: "Write it up", by: "agent" });
		await machine.flushWrites();
		expect(files.has("/agents/Researcher/.tasks")).toBe(false);
		expect(
			JSON.parse(files.get("/agents/Analyst/.tasks") ?? "").tasks,
		).toHaveLength(2);
	});

	it("tracks tasks in Tasks without taking the agent's focus", async () => {
		vi.setSystemTime(new Date(2026, 9, 4, 9, 30));
		const { machine } = createMachine();
		await machine.openFolder("/notes");
		const filesWindow = machine.findWindow("files")?.id;

		const task = machine.addTask({
			title: "Write the report",
			checklist: ["Search sources", "Read the top 3", "Write it"],
			state: "in_progress",
			by: "agent",
		});
		machine.checkTaskItem(task.id, 1, true);
		machine.addTask({ title: "Add charts", by: "agent" });
		machine.addTask({ title: "Translate it", by: "user" });

		expect(machine.snapshot().focusedWindowId).toBe(filesWindow);
		let screen = machine.readScreen();
		expect(screen).toContain(
			"tasks: 1 in progress · 1 approved (waiting for you) · 1 new (waiting for the user's approval) · now: #1 Write the report (1/3)",
		);
		expect(screen).toContain("Tasks · 3 open");

		machine.focusWindow(machine.findWindow("tasks")!.id);
		screen = machine.readScreen();
		expect(screen).toContain("[n1] New task: (empty) · [n2] Add");
		expect(screen).toContain(
			"[~] #1 Write the report — added by the agent 2026-10-04 09:30 (in progress)",
		);
		expect(screen).toContain("[n3] [x] Search sources");
		expect(screen).toContain("[n4] [ ] Read the top 3");
		expect(screen).toContain(
			"[n6] State: in progress (choose: new | approved | in_progress | done | dropped) · [n7] Edit",
		);
		// The user approves a proposal; the agent never sees that button.
		expect(screen).toContain(
			"[ ] #2 Add charts — added by the agent 2026-10-04 09:30 (new · waiting for approval)",
		);
		expect(screen).not.toContain("Approve");
		// Started, approved, proposed: the order work goes in.
		expect(screen.indexOf("#3 Translate it")).toBeLessThan(
			screen.indexOf("#2 Add charts"),
		);
		expect(() => machine.checkTaskItem(1, 9, true)).toThrow(
			"Task #1 has no item 9; its checklist has 3.",
		);
		expect(() => machine.setTaskState(9, "done")).toThrow(
			"Tasks has no task #9. Open tasks: #1, #2, #3.",
		);
	});

	it("keeps finished tasks as the record, and lets only the user delete one", async () => {
		const { machine } = createMachine();
		const first = machine.addTask({
			title: "Ship v1",
			checklist: ["Build", "Release"],
			by: "user",
		});
		expect(first.state).toBe("approved");
		machine.setTaskState(first.id, "in_progress");
		const done = machine.setTaskState(first.id, "done");
		expect(done.finishedAt).toEqual(expect.any(Number));
		const second = machine.addTask({ title: "Old idea", by: "agent" });
		machine.setTaskState(second.id, "dropped");
		machine.focusWindow(machine.findWindow("tasks")!.id);

		let screen = machine.readScreen();
		expect(screen).toContain("Tasks · 0 open · 2 finished");
		expect(screen).toContain("No open tasks.");
		expect(screen).toContain("Finished (2): [n3] [off] Show");
		expect(screen).not.toContain("Ship v1");
		await machine.actOnControl("n3", "toggle");
		screen = machine.readScreen();
		expect(screen).toContain("[x] #1 Ship v1");
		expect(screen).toContain("- #2 Old idea");

		// A finished task folds its checklist away until asked for it.
		expect(screen).not.toContain("Release");
		const details = /\[(n\d+)\] Details/.exec(screen)?.[1];
		if (!details) throw new Error("no Details on the screen");
		await machine.actOnControl(details, "click");
		screen = machine.readScreen();
		expect(screen).toContain("[ ] Release");
		expect(screen).toMatch(/\[n\d+\] Hide details/);

		// Reopened, a task loses its finish time; ids are never reused.
		expect(machine.setTaskState(first.id, "in_progress").finishedAt).toBe(
			undefined,
		);
		machine.removeTask(second.id);
		expect(machine.addTask({ title: "Next", by: "agent" }).id).toBe(2);
		machine.removeTask(2);
		expect(machine.addTask({ title: "After", by: "agent" }).id).toBe(2);
	});

	it("keeps tasks in the hidden ~/.tasks, and opens .tasks files in Tasks", async () => {
		const { machine, files } = createMachine();
		await machine.prepareDesktop();
		expect(files.has("/agents/guest/.tasks")).toBe(false);

		const task = machine.addTask({
			title: "Write the report",
			checklist: ["Search sources", "Write it"],
			state: "in_progress",
			by: "agent",
		});
		machine.checkTaskItem(task.id, 1, true);
		await machine.flushWrites();
		const saved = JSON.parse(files.get("/agents/guest/.tasks") ?? "");
		expect(saved.tasks).toEqual([
			expect.objectContaining({
				id: 1,
				title: "Write the report",
				state: "in_progress",
				createdBy: "agent",
				createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
				checklist: [
					{ text: "Search sources", done: true },
					{ text: "Write it", done: false },
				],
			}),
		]);
		// Hidden, like a dotfile: not on the desktop.
		await machine.refreshDesktop();
		expect(machine.snapshot().desktop.map((entry) => entry.name)).not.toContain(
			".tasks",
		);

		// The next computer reads them back.
		const { machine: next, files: nextFiles } = createMachine();
		nextFiles.set(
			"/agents/guest/.tasks",
			files.get("/agents/guest/.tasks") ?? "",
		);
		await next.prepareDesktop();
		expect(next.snapshot().tasks).toMatchObject({
			items: [
				{
					title: "Write the report",
					checklist: [{ done: true }, { done: false }],
				},
			],
			path: "/agents/guest/.tasks",
		});

		// Another .tasks file opens in Tasks; the Editor never shows it.
		files.set(
			"/agents/guest/Trip.tasks",
			JSON.stringify({ tasks: [{ title: "Book flights" }] }),
		);
		await machine.openFile("~/Trip.tasks");
		expect(machine.findWindow("editor")).toBeUndefined();
		expect(machine.snapshot().focusedWindowId).toBe(
			machine.findWindow("tasks")?.id,
		);
		expect(machine.snapshot().tasks.path).toBe("/agents/guest/Trip.tasks");
		expect(machine.readScreen()).toContain("Tasks · ~/Trip.tasks · 1 open");
		machine.setTaskState(1, "done");
		await machine.flushWrites();
		expect(
			JSON.parse(files.get("/agents/guest/Trip.tasks") ?? "").tasks[0],
		).toMatchObject({ title: "Book flights", state: "done" });

		// A file that is not tasks is reported, not lost.
		files.set("/agents/guest/broken.tasks", "{ not json");
		await machine.openFile("~/broken.tasks");
		expect(machine.snapshot().tasks.error).toContain("is not tasks");
		expect(machine.snapshot().tasks.items.map((item) => item.title)).toEqual([
			"Book flights",
		]);
	});

	it("moves an older version's notes and history to their hidden files", async () => {
		const { machine, files } = createMachine();
		files.set(
			"/agents/guest/my.notes",
			JSON.stringify({
				items: [
					{ text: "Search sources", status: "done" },
					{ text: "Write it", status: "doing" },
				],
				text: "Source: example.com",
			}),
		);
		files.set(
			"/agents/guest/my.terminal",
			JSON.stringify({ history: ["ls", "node app.js"] }),
		);
		await machine.prepareDesktop();

		expect(files.has("/agents/guest/my.notes")).toBe(false);
		expect(files.has("/agents/guest/my.terminal")).toBe(false);
		expect(files.get("/agents/guest/Notes.md")).toBe(
			"# Notes\n\nSource: example.com\n",
		);
		expect(machine.snapshot().tasks.items).toMatchObject([
			{
				title: "Earlier plan",
				state: "in_progress",
				checklist: [
					{ text: "Search sources", done: true },
					{ text: "Write it", done: false },
				],
			},
		]);
		expect(machine.snapshot().terminal.history).toEqual(["ls", "node app.js"]);
		expect(
			machine
				.snapshot()
				.desktop.map((entry) => entry.name)
				.sort(),
		).toEqual(["Bot.md", "Memory.md", "Notes.md"]);
	});

	it("opens .tasks and .terminal files as JSON text without their apps", async () => {
		const { machine, files } = createMachine({
			apps: {
				...DEFAULT_MEMON_FEATURE_CONFIG.apps,
				tasks: false,
				terminal: false,
			},
		});
		files.set("/agents/guest/Trip.tasks", '{ "tasks": [] }');
		await machine.openFile("~/Trip.tasks");
		expect(machine.snapshot().editor).toMatchObject({
			path: "/agents/guest/Trip.tasks",
			content: '{ "tasks": [] }',
		});
		files.set("/agents/guest/Dev.terminal", '{ "command": "npm run dev" }');
		await machine.openFile("~/Dev.terminal");
		expect(machine.snapshot().editor.path).toBe("/agents/guest/Dev.terminal");
	});

	it("keeps Tasks closed when the agent has no Planner", () => {
		const { machine } = createMachine({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, tasks: false },
		});
		expect(() => machine.addTask({ title: "Plan", by: "agent" })).toThrow(
			"The tasks app is turned off for this agent.",
		);
		expect(() => machine.openWindow("tasks")).toThrow(
			"The tasks app is turned off for this agent.",
		);
		expect(machine.findWindow("tasks")).toBeUndefined();
	});

	it("saves a command as a launcher that runs in a new tab when opened", async () => {
		const { machine, files, ports } = createMachine();
		await machine.prepareDesktop();
		await machine.terminal.runCommand("cd /notes");
		const path = await machine.saveTerminalLauncher(
			"Start Notes Server",
			"node server.js",
		);
		expect(path).toBe("/agents/guest/Start Notes Server.terminal");
		expect(JSON.parse(files.get(path) ?? "")).toEqual({
			command: "node server.js",
			cwd: "/notes",
		});
		expect(machine.snapshot().desktop.map((entry) => entry.name)).toContain(
			"Start Notes Server.terminal",
		);

		// The user's click runs it in a tab of its own, where it says.
		await machine.openFile(path, { byUser: true });
		const { terminal } = machine.snapshot();
		expect(terminal.tabs.map((tab) => tab.id)).toEqual(["1", "2"]);
		expect(terminal.activeTabId).toBe("2");
		expect(terminal.cwd).toBe("/notes");
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"node server.js",
			expect.objectContaining({ cwd: "/notes" }),
		);
		expect(machine.findWindow("editor")).toBeUndefined();

		// A launcher in the home runs there; a fresh tab in front is reused.
		const { machine: fresh, files: freshFiles } = createMachine();
		freshFiles.set(
			"/agents/guest/Build.terminal",
			'{ "command": "npm run build" }',
		);
		await fresh.openFile("~/Build.terminal", { byUser: true });
		expect(fresh.snapshot().terminal.tabs).toMatchObject([
			{ id: "1", cwd: "/agents/guest", command: "npm run build" },
		]);

		// The Editor shows what a launcher runs, without running it.
		const runs = vi.mocked(ports.terminal.run).mock.calls.length;
		await machine.openFile(path, { asText: true });
		expect(machine.snapshot().editor).toMatchObject({
			path,
			content: expect.stringContaining('"command": "node server.js"'),
		});
		expect(vi.mocked(ports.terminal.run).mock.calls.length).toBe(runs);

		// An older history file is no launcher: it opens as text.
		files.set("/agents/guest/old.terminal", '{ "history": ["ls"] }');
		await machine.openFile("~/old.terminal");
		expect(machine.snapshot().editor.path).toBe("/agents/guest/old.terminal");
		await expect(machine.saveTerminalLauncher("Empty", "  ")).rejects.toThrow(
			"A launcher needs a command.",
		);
	});

	it("runs a studio tool in the Studio window and keeps the result as text", async () => {
		const { machine, files } = createMachine();
		await machine.openStudio(null);
		let screen = machine.readScreen();
		expect(screen).toContain("── w1 Studio · 1/2 tools ready · 0 runs");
		expect(screen).toContain("[s1] Tool: *all* · decision · speech");
		expect(screen).toContain("- Transcribe — whisper-tiny");
		expect(screen).toContain("- Image — no model chosen in Studio");
		expect(screen).toContain("No studio runs yet.");

		const run = await machine.runStudio(
			{ tool: "transcribe", path: "/notes/talk.mp3" },
			"/notes/talk.txt",
		);
		expect(run).toMatchObject({
			status: "done",
			conversationId: "studio-session",
		});
		expect(files.get("/notes/talk.txt")).toBe(
			"Transcript (en):\nhello world hello world hello world",
		);
		screen = machine.readScreen();
		expect(screen).toContain(
			"[s1] Tool: all · decision · speech · *transcribe*",
		);
		expect(screen).toContain("model: whisper-tiny");
		expect(screen).toContain("- Transcribe · done — whisper-tiny");
		expect(screen).toContain("  hello world hello world hello world");

		await expect(
			machine.runStudio({ tool: "image", text: "a cat" }),
		).rejects.toThrow("Image has no model.");
		expect(machine.snapshot().studio.runs[0]).toMatchObject({
			tool: "image",
			status: "failed",
			error: "Image has no model.",
		});
	});

	it("lists, reads and switches the agent's skills", async () => {
		const { machine, ports } = createMachine();
		await machine.openSkills();
		let screen = machine.readScreen();
		expect(screen).toContain("1 of 2 in use");
		expect(screen).toContain(
			"- research-writer — Write research reports with sources. [k4] [on] Use (unavailable: the computer has no agent) · [k5] Open",
		);
		expect(screen).toContain("- pdf-tools — Read and split PDFs. (built in)");

		// Without an agent nothing is saved.
		await expect(machine.setSkillEnabled("pdf-tools", true)).rejects.toThrow(
			"This computer has no agent yet",
		);
		machine.setAgent("agent-1");
		await machine.setSkillEnabled("pdf-tools", true);
		expect(ports.skills.setEnabled).toHaveBeenCalledWith(
			"agent-1",
			"pdf-tools",
			true,
		);
		expect(machine.readScreen()).toContain("2 of 2 in use");

		await machine.openSkill("research-writer");
		screen = machine.readScreen();
		expect(screen).toContain("research-writer");
		expect(screen).toContain("[on] Use");
		expect(screen).toContain("  Cite every source.");

		await expect(machine.deleteSkill("pdf-tools")).rejects.toThrow(
			'"pdf-tools" is a built-in skill and cannot be deleted.',
		);
		await expect(machine.openSkill("nope")).rejects.toThrow(
			'There is no skill "nope".',
		);
	});

	it("shows the user's connections and grants one to the agent", async () => {
		const { machine, ports } = createMachine();
		machine.setAgent("agent-1");
		await machine.openConnections();
		let screen = machine.readScreen();
		expect(screen).toContain("0 of 1 granted");
		expect(screen).toContain(
			"- 1. Gmail — via Composio · connected · 1 tools [c2] [off] Use in this agent · [c3] Show tools",
		);
		expect(screen).toContain("note: The passkey is locked");

		await machine.setConnectionGranted(machine.connectionAt(1).key, true);
		expect(ports.connections.setGranted).toHaveBeenCalledWith(
			"agent-1",
			"c1::gmail",
			true,
		);
		machine.selectConnection("c1::gmail");
		screen = machine.readScreen();
		expect(screen).toContain(
			"- 1. Gmail — via Composio · connected · 1 tools (granted)",
		);
		expect(screen).toContain("[c2] [on] Use in this agent · [c3] Hide tools");
		expect(screen).toContain(
			"  - c1__GMAIL_SEND — Send an email (destructive)",
		);
		expect(() => machine.connectionAt(4)).toThrow(
			"Connections has no connection 4; it has 1.",
		);
	});

	it("brings the real page of the active tab to the front", async () => {
		const { machine, ports } = createMachine();
		await expect(machine.showBrowserTab()).rejects.toThrow(
			"No page is open in the Browser.",
		);
		await machine.openUrl("https://example.com");
		await machine.showBrowserTab();
		expect(ports.browser.focus).toHaveBeenCalledWith("s1");
	});

	it("keeps Memory.md and Bot.md entries even with the Files app off", async () => {
		const { machine, files } = createMachine({
			apps: {
				browser: true,
				files: false,
				terminal: false,
				tasks: true,
				visualize: false,
			},
		});

		const added = await machine.editDesktopFile("memory", {
			action: "add",
			text: "Prefers short answers",
		});
		expect(added.entries).toEqual(["Prefers short answers"]);
		expect(files.get("/agents/guest/Memory.md")).toContain(
			"- Prefers short answers",
		);

		await machine.editDesktopFile("bot", {
			action: "add",
			text: "Always answer in Vietnamese",
		});
		const bot = await machine.editDesktopFile("bot", { action: "list" });
		expect(bot.entries).toEqual(["Always answer in Vietnamese"]);
		expect(files.get("/agents/guest/Bot.md")).toContain("# Bot.md");
	});

	it("shows the agent's memory change in an open, saved Editor", async () => {
		const { machine, files } = createMachine();
		files.set("/agents/guest/Memory.md", "# Memory.md\n");
		await machine.openFile("~/Memory.md");

		await machine.editDesktopFile("memory", {
			action: "add",
			text: "Uses Edge",
		});

		expect(machine.snapshot().editor.content).toContain("- Uses Edge");
	});

	it("lets the agent use the Tasks controls by their refs", async () => {
		const { machine } = createMachine();
		await expect(machine.actOnControl("n1", "click")).rejects.toThrow(
			"The tasks window is not open",
		);
		machine.addTask({
			title: "Write the report",
			checklist: ["Search sources"],
			state: "in_progress",
			by: "user",
		});
		machine.openWindow("tasks");

		// n1 new task · n2 Add · n3 Search sources · n4 State · n5 Edit
		await expect(machine.actOnControl("n2", "click")).rejects.toThrow(
			"Add is unavailable: type the task first.",
		);
		expect(await machine.actOnControl("n1", "type", "Add charts")).toBe("");
		expect(machine.snapshot().drafts["tasks:new"]).toBe("Add charts");
		// The agent's task is a proposal until the user approves it.
		expect(await machine.actOnControl("n2", "click")).toBe(
			'added task #2 "Add charts" to Tasks',
		);
		expect(machine.taskById(2).state).toBe("new");
		expect(await machine.actOnControl("n3", "toggle")).toBe(
			'ticked "Search sources" of task #1 in Tasks',
		);
		expect(machine.taskById(1).checklist[0]?.done).toBe(true);
		expect(await machine.actOnControl("n4", "select", "done")).toBe(
			'set task #1 "Write the report" to done in Tasks',
		);
		await expect(machine.actOnControl("n99", "click")).rejects.toThrow(
			"There is no n99 on the tasks window now.",
		);

		// Edit fills a shared form; Save keeps ticks by text, [x] sets one.
		const edit = /\[(n\d+)\] Edit/.exec(machine.readScreen());
		if (!edit?.[1]) throw new Error("no Edit on the screen");
		await machine.actOnControl(edit[1], "click");
		const screen = machine.readScreen();
		const checklist = /\[(n\d+)\] Checklist/.exec(screen)?.[1];
		const save = /\[(n\d+)\] Save/.exec(screen)?.[1];
		if (!checklist || !save) throw new Error("no edit form on the screen");
		await machine.actOnControl(
			checklist,
			"type",
			"Add a chart\n[x] Pick colors",
		);
		expect(await machine.actOnControl(save, "click")).toBe(
			'edited task #2 "Add charts" in Tasks',
		);
		expect(machine.taskById(2).checklist).toEqual([
			{ text: "Add a chart", done: false },
			{ text: "Pick colors", done: true },
		]);
		expect(machine.snapshot().drafts["tasks:edit"]).toBeUndefined();
	});

	it("lets the agent fill and run a studio form by its refs", async () => {
		const { machine, ports } = createMachine();
		await machine.openStudio(null);
		// s1 is the tool tabs.
		await expect(machine.actOnControl("s1", "select", "nope")).rejects.toThrow(
			"s1 takes one of: all, decision",
		);
		expect(await machine.actOnControl("s1", "select", "Transcribe")).toBe(
			"showed Transcribe in Studio",
		);
		const screen = machine.readScreen();
		expect(screen).toContain("model: whisper-tiny");
		const field = /\[(s\d+)\] Audio or video file: \(empty\)/.exec(screen);
		const run = /\[(s\d+)\] Run\b/.exec(screen);
		if (!field?.[1] || !run?.[1]) throw new Error("no form on the screen");
		await machine.actOnControl(field[1], "type", "/notes/talk.mp3");
		expect(await machine.actOnControl(run[1], "click")).toBe(
			"Transcribe finished.\nTranscript (en):\nhello world hello world hello world",
		);
		expect(ports.studio.run).toHaveBeenCalledWith(
			{ tool: "transcribe", path: "/notes/talk.mp3" },
			{ sessionKey: "memon:conversation-1", agentId: null },
		);
	});

	it("saves a studio setup as a .studio app and runs it with its settings", async () => {
		const { machine, files, ports } = createMachine();
		await machine.prepareDesktop();
		await machine.openStudio("transcribe");
		const screen = machine.readScreen();
		const language = /\[(s\d+)\] Language \(e\.g\. en\): \(empty\)/.exec(
			screen,
		)?.[1];
		const name = /\[(s\d+)\] Save these settings as an app on the desktop/.exec(
			screen,
		)?.[1];
		if (!language || !name) throw new Error("no form on the screen");
		await machine.actOnControl(language, "type", "vi");
		await machine.actOnControl(name, "type", "Vietnamese Interviews");
		const install = /\[(s\d+)\] Save as app/.exec(machine.readScreen())?.[1];
		if (!install) throw new Error("no Save as app on the screen");
		expect(await machine.actOnControl(install, "click")).toBe(
			"saved Transcribe as the app ~/Vietnamese Interviews.studio",
		);
		const path = "/agents/guest/Vietnamese Interviews.studio";
		// The input (a file) is given each run, so it is never kept.
		expect(JSON.parse(files.get(path) ?? "")).toEqual({
			tool: "transcribe",
			title: "Vietnamese Interviews",
			language: "vi",
		});
		expect(machine.snapshot().desktop.map((entry) => entry.name)).toContain(
			"Vietnamese Interviews.studio",
		);

		// Opened again later, it fills the form and names the runs.
		machine.setDraft("studio:transcribe:language", "en");
		machine.closeStudioApp();
		await machine.openFile(path);
		expect(machine.snapshot().studio).toMatchObject({
			selected: "transcribe",
			app: { path, title: "Vietnamese Interviews", tool: "transcribe" },
		});
		expect(machine.snapshot().drafts["studio:transcribe:language"]).toBe("vi");
		const run = await machine.runStudio({
			tool: "transcribe",
			path: "/notes/talk.mp3",
			language: "vi",
		});
		expect(run.app).toBe("Vietnamese Interviews");
		expect(ports.studio.run).toHaveBeenLastCalledWith(
			{ tool: "transcribe", path: "/notes/talk.mp3", language: "vi" },
			expect.anything(),
		);

		// Settings the form has no field for are still on the screen.
		files.set(
			"/agents/guest/Detect.studio",
			JSON.stringify({ tool: "transcribe", language: "en", threshold: 0.4 }),
		);
		await machine.openFile("~/Detect.studio");
		const appScreen = machine.readScreen();
		expect(appScreen).toContain("also set: threshold 0.4");
		expect(appScreen).not.toContain("also set: language");

		files.set("/agents/guest/Broken.studio", '{ "tool": "nope" }');
		await expect(machine.openFile("~/Broken.studio")).rejects.toThrow(
			"~/Broken.studio is not a studio app",
		);
	});

	it("moves, copies, cuts and pastes files for the user and the agent", async () => {
		const { machine, files } = createMachine();
		files.set("/notes/b.md", "bee");
		await machine.openFolder("/");
		await expect(machine.moveFiles(["/notes"], "/notes")).rejects.toThrow(
			"/notes cannot be moved into itself.",
		);
		await expect(machine.moveFiles(["/nope.md"], "/")).rejects.toThrow(
			"/nope.md does not exist any more.",
		);

		await machine.openFile("/notes/a.md");
		expect(await machine.moveFiles(["/notes/a.md"], "/")).toEqual(["/a.md"]);
		expect(files.get("/a.md")).toBe("hello");
		// The open file follows its move.
		expect(machine.snapshot().editor.path).toBe("/a.md");

		expect(await machine.copyFiles(["/a.md"], "/")).toEqual(["/a copy.md"]);
		expect(await machine.copyFiles(["/a.md"], "/")).toEqual(["/a copy 2.md"]);

		await machine.openFolder("/");
		const ref = machine.readScreen().match(/\[(f\d+)\] a\.md/)?.[1];
		if (!ref) throw new Error("a.md is not on the screen");
		expect(machine.fileRefPath(ref)).toBe("/a.md");
		machine.setFileClipboard("cut", [machine.fileRefPath(ref)]);
		expect(machine.readScreen()).toContain("clipboard: cut a.md");
		await machine.openFolder("/notes");
		expect(await machine.pasteFiles()).toEqual({
			mode: "cut",
			placed: ["/notes/a.md"],
		});
		expect(files.has("/a.md")).toBe(false);
		expect(machine.snapshot().files.clipboard).toBeNull();
		await expect(machine.pasteFiles()).rejects.toThrow(
			"Nothing is cut or copied in Files.",
		);
	});

	it("deletes files and folders, leaving a deleted folder it had open", async () => {
		const { machine, files } = createMachine();
		files.set("/notes/b.md", "bee");
		files.set("/c.md", "sea");
		await machine.openFolder("/notes");
		machine.setFileClipboard("copy", ["/notes/b.md", "/c.md"]);
		await expect(machine.deleteFiles(["/"])).rejects.toThrow(
			"/ cannot be deleted.",
		);
		await expect(machine.deleteFiles([machine.home])).rejects.toThrow(
			`${machine.home} cannot be deleted.`,
		);

		expect(await machine.deleteFiles(["/notes", "/notes"])).toEqual(["/notes"]);
		expect([...files.keys()].some((path) => path.startsWith("/notes/"))).toBe(
			false,
		);
		// Files steps out of the folder that is gone; the clipboard forgets it.
		expect(machine.snapshot().files.cwd).toBe("/");
		expect(machine.snapshot().files.clipboard?.paths).toEqual(["/c.md"]);

		await machine.deleteFiles(["c.md"]);
		expect(files.has("/c.md")).toBe(false);
		expect(machine.snapshot().files.clipboard).toBeNull();
	});

	it("closes the servers a stopped command opened, and only those", async () => {
		const { ports } = createPorts();
		const listening = new Set([5173]);
		const stopServer = vi.fn(async (port: number) => {
			listening.delete(port);
		});
		ports.embedded = {
			availability: () => ({ available: true }),
			open: vi.fn(),
			navigate: vi.fn(),
			outline: vi.fn(),
			act: vi.fn(),
			history: vi.fn(async () => undefined),
			focus: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			reserve: vi.fn(() => () => undefined),
			servers: vi.fn(async () => [...listening].sort()),
			stopServer,
		} as unknown as MemonEmbeddedPort;
		vi.mocked(ports.terminal.run).mockImplementationOnce(async () => {
			listening.add(3000);
			return {
				processId: "server",
				running: true,
				exitCode: null,
				output: [{ kind: "stdout", text: "listening on 3000" }],
			};
		});
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		vi.mocked(ports.terminal.stop).mockRejectedValueOnce(new Error("gone"));
		const machine = new MemonMachine(
			"conversation-1",
			ports,
			DEFAULT_MEMON_FEATURE_CONFIG,
		);

		await machine.terminal.runCommand("node server.js", { waitMs: 0 });
		await machine.terminal.stopCommand();
		expect(stopServer).toHaveBeenCalledTimes(1);
		expect(stopServer).toHaveBeenCalledWith(3000);
		expect([...listening]).toEqual([5173]);
		expect(machine.snapshot().terminal.lines.at(-1)?.text).toBe(
			"Closed localhost:3000.",
		);
	});

	it("shows servers of the computer in embedded tabs and other pages in real ones", async () => {
		const { ports } = createPorts();
		let embeddedSession = 0;
		const embedded: MemonEmbeddedPort = {
			availability: () => ({ available: true }),
			open: vi.fn(async (url: string) => ({
				sessionId: `embedded-${++embeddedSession}`,
				url,
				title: "",
			})),
			navigate: vi.fn(async (_sessionId: string, url: string) => ({
				url,
				title: "",
			})),
			outline: vi.fn(async () => outline("http://localhost:3000/", "Todo app")),
			act: vi.fn(),
			history: vi.fn(async () => undefined),
			focus: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			reserve: vi.fn(() => () => undefined),
			servers: vi.fn(async () => [3000]),
			capture: vi.fn(async () => ({
				dataUrl: "data:image/png;base64,AAAA",
				width: 2,
				height: 2,
			})),
		};
		ports.embedded = embedded;
		const machine = new MemonMachine(
			"conversation-1",
			ports,
			DEFAULT_MEMON_FEATURE_CONFIG,
		);
		expect(normalizeBrowserUrl("localhost:3000/todos")).toBe(
			"http://localhost:3000/todos",
		);

		await machine.openUrl("localhost:3000");
		expect(embedded.open).toHaveBeenCalledWith("http://localhost:3000", {
			windowId: undefined,
		});
		expect(ports.browser.open).not.toHaveBeenCalled();
		expect(machine.snapshot().browser.tabs[0]).toMatchObject({
			kind: "embedded",
			title: "Todo app",
		});
		expect(machine.readScreen()).toContain(
			"embedded (a server in this computer, shown in the window)",
		);

		// A real page opens beside it, in a real tab.
		await machine.openUrl("https://example.com");
		expect(ports.browser.open).toHaveBeenCalledTimes(1);
		expect(machine.snapshot().browser.tabs).toHaveLength(2);
		expect(machine.readScreen()).toContain('"Todo app" (embedded)');

		// A local address the computer does not serve is the user's own
		// server, which only a real tab reaches.
		await machine.openUrl("localhost:4000");
		expect(ports.browser.navigate).toHaveBeenCalledWith(
			"s1",
			"http://localhost:4000",
		);
		expect(embedded.open).toHaveBeenCalledTimes(1);
		// Asked for, it opens embedded anyway.
		await machine.openUrl("localhost:4000", { embedded: true, newTab: true });
		expect(embedded.open).toHaveBeenLastCalledWith("http://localhost:4000", {
			windowId: undefined,
		});
		expect(machine.snapshot().browser.tabs).toHaveLength(3);

		await machine.selectTab(1);
		await machine.openUrl("http://localhost:3000/done", { embedded: true });
		expect(embedded.navigate).toHaveBeenCalledWith(
			"embedded-1",
			"http://localhost:3000/done",
		);
		await machine.showBrowserTab();
		expect(ports.browser.focus).not.toHaveBeenCalled();

		await machine.terminal.checkServers();
		machine.focusWindow(machine.openWindow("terminal").id);
		expect(machine.readScreen()).toContain(
			"serving http://localhost:3000 — a server keeps running",
		);
	});

	it("takes a picture of a page ref where the page is shown, and saves it for a model that cannot look", async () => {
		const { ports, files } = createPorts();
		const embedded: MemonEmbeddedPort = {
			availability: () => ({ available: true }),
			open: vi.fn(async (url: string) => ({
				sessionId: "embedded-1",
				url,
				title: "",
			})),
			navigate: vi.fn(),
			outline: vi.fn(async () => outline("http://localhost:8347/", "Game")),
			act: vi.fn(),
			history: vi.fn(async () => undefined),
			focus: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			reserve: vi.fn(() => () => undefined),
			servers: vi.fn(async () => [8347]),
			capture: vi.fn(async () => ({
				dataUrl: `data:image/png;base64,${btoa("png")}`,
				width: 880,
				height: 594,
			})),
		};
		ports.embedded = embedded;
		const machine = new MemonMachine(
			"conversation-1",
			ports,
			DEFAULT_MEMON_FEATURE_CONFIG,
		);
		await machine.openUrl("localhost:8347");

		// The ref as the agent read it: a stale page refuses it.
		const picture = await machine.captureRef("b1");
		expect(embedded.capture).toHaveBeenCalledWith("embedded-1", {
			ref: "b1",
			docToken: "doc-Game",
		});
		expect(picture).toMatchObject({ width: 880, height: 594 });

		// No models port, or a model that takes no images: the picture is a file.
		expect(await machine.modelAcceptsImages()).toBe(false);
		const saved = await machine.savePicture(picture.dataUrl, "b1-picture");
		expect(saved).toBe(`${machine.home}/Pictures/b1-picture.png`);
		expect(files.get(saved)).toEqual(new TextEncoder().encode("png"));

		ports.models = {
			llm: vi.fn(),
			acceptsImages: vi.fn(async () => true),
		};
		expect(await machine.modelAcceptsImages()).toBe(true);
	});

	it("opens any local address embedded where there are no real tabs", async () => {
		const { ports } = createPorts();
		ports.browser.availability = () => ({
			available: false,
			reason: "the web app cannot drive a browser",
		});
		const embedded: MemonEmbeddedPort = {
			availability: () => ({ available: true }),
			open: vi.fn(async (url: string) => ({
				sessionId: "embedded-1",
				url,
				title: "",
			})),
			navigate: vi.fn(),
			outline: vi.fn(async () => outline("http://localhost:4000/", "Todo")),
			act: vi.fn(),
			history: vi.fn(async () => undefined),
			focus: vi.fn(async () => undefined),
			close: vi.fn(async () => undefined),
			reserve: vi.fn(() => () => undefined),
			servers: vi.fn(async () => []),
			capture: vi.fn(async () => ({
				dataUrl: "data:image/png;base64,AAAA",
				width: 2,
				height: 2,
			})),
		};
		ports.embedded = embedded;
		const machine = new MemonMachine(
			"conversation-1",
			ports,
			DEFAULT_MEMON_FEATURE_CONFIG,
		);

		await machine.openUrl("localhost:4000");
		expect(embedded.open).toHaveBeenCalledWith("http://localhost:4000", {
			windowId: undefined,
		});
		expect(ports.browser.open).not.toHaveBeenCalled();
	});

	it("shows a visual, keeps it as a .openui file and opens it again", async () => {
		const { machine, files } = createMachine({
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, visualize: true },
		});
		machine.setAgent("agent-1", "/agents/Researcher");
		await expect(machine.showVisual('TextContent("no root")')).rejects.toThrow(
			"A visual starts with its root",
		);

		const report = [
			'root = CardBlock("Sales report", "Q3", [section_1])',
			'section_1 = TextContent("Up 12%")',
		].join("\n");
		const path = await machine.showVisual(report);
		expect(path).toBe("/agents/Researcher/Visuals/Sales report.openui");
		expect(files.get(path)).toBe(`${report}\n`);
		expect(machine.snapshot().visual).toMatchObject({
			path,
			title: "Sales report",
			theme: "shadcn",
		});
		let screen = machine.readScreen();
		expect(screen).toContain(
			'── w1 Visualize · "Sales report" · ~/Visuals/Sales report.openui · 2 lines',
		);
		expect(screen).toContain('  section_1 = TextContent("Up 12%")');

		// The visual on screen is updated in place.
		const updated = report.replace("Up 12%", "Up 15%");
		expect(await machine.showVisual(updated)).toBe(path);
		expect(files.get(path)).toContain("Up 15%");

		// Another visual with the same title is kept, not overwritten.
		files.set("/notes/old.md", "x");
		await machine.openFolder("/notes");
		await machine.openFile("/notes/a.md");
		await machine.showVisual(report, { path: "~/Visuals/Copy" });
		expect(files.get("/agents/Researcher/Visuals/Copy.openui")).toBe(
			`${report}\n`,
		);
		expect(await machine.showVisual(report)).toBe(
			"/agents/Researcher/Visuals/Sales report 2.openui",
		);

		// Files opens a .openui file in Visualize, and the user's edit saves.
		await machine.openFile(path);
		expect(machine.snapshot().visual.source).toContain("Up 15%");
		expect(machine.snapshot().focusedWindowId).toBe(
			machine.findWindow("visualize")?.id,
		);
		await machine.saveVisual(report.replace("Up 12%", "Flat"));
		expect(files.get(path)).toContain("Flat");
		screen = machine.readScreen();
		expect(screen).toContain('TextContent("Flat")');
	});

	it("edits a task's checklist keeping its ticks, and refuses an empty title", () => {
		const { machine } = createMachine();
		const task = machine.addTask({
			title: "Serach sources",
			checklist: ["One", "Two"],
			by: "agent",
		});
		machine.checkTaskItem(task.id, 2, true);
		machine.editTask(task.id, {
			title: "Search sources",
			checklist: ["Two", "Three", "[ ] One"],
		});
		expect(machine.taskById(task.id)).toMatchObject({
			title: "Search sources",
			checklist: [
				{ text: "Two", done: true },
				{ text: "Three", done: false },
				{ text: "One", done: false },
			],
		});
		expect(() => machine.editTask(task.id, { title: "  " })).toThrow(
			"A task needs a title.",
		);
	});

	it("views, creates, edits and deletes the agent's schedules", async () => {
		const { machine, ports } = createMachine();
		await machine.openScheduler();
		expect(machine.readScreen()).toContain("This computer has no agent yet.");

		machine.setAgent("agent-1");
		await machine.saveSchedule({
			name: "Morning brief",
			prompt: "Summarize agent quality news",
			scheduleExpression: "0 9 * * *",
			status: "active",
			metadata: { scheduleMode: "daily", time: "09:00" },
		});
		expect(ports.scheduler.save).toHaveBeenCalledWith(
			"agent-1",
			expect.objectContaining({ scheduleExpression: "0 9 * * *" }),
		);
		machine.focusWindow(machine.findWindow("scheduler")!.id);
		let screen = machine.readScreen();
		expect(screen).toContain("── w1 Scheduler · 1 schedule");
		expect(screen).toContain(
			"Schedules of Researcher: [h1] New · [h2] Refresh",
		);
		expect(screen).toContain(
			"- 1. Morning brief — every day at 09:00 (0 9 * * *) (active)",
		);
		expect(screen).toContain("prompt: Summarize agent quality news");
		expect(screen).toContain("[h3] Edit · [h4] Pause · [h5] Delete");

		const first = machine.scheduleAt(1);
		await machine.saveSchedule({ ...first, status: "paused" });
		expect(machine.readScreen()).toContain("(paused)");

		await expect(
			machine.saveSchedule({ ...first, scheduleExpression: "every day" }),
		).rejects.toThrow('"every day" is not a schedule');

		await machine.deleteSchedule(first.id);
		screen = machine.readScreen();
		expect(screen).toContain("No scheduled prompts yet.");
		expect(() => machine.scheduleAt(1)).toThrow(
			"The Scheduler has no schedule 1; it has 0.",
		);
	});

	it("refuses apps the agent's settings turned off", async () => {
		const { machine } = createMachine({
			apps: {
				browser: false,
				files: true,
				terminal: true,
				tasks: true,
				visualize: false,
			},
		});
		await expect(machine.openUrl("https://example.com")).rejects.toThrow(
			/turned off/,
		);
	});
});

describe("MemonMachine zipping a folder for the user", () => {
	it("zips into Downloads and hands each zip to the user once", async () => {
		const { machine, ports, files } = createMachine();

		const saved = await machine.exportFolderZip("/notes");
		expect(saved).toMatchObject({
			path: `${machine.home}/Downloads/notes.zip`,
			fileCount: 1,
		});
		expect(ports.files.zip).toHaveBeenCalledWith("/notes");
		expect(files.has(saved.path)).toBe(true);
		expect(machine.snapshot().files.exported).toMatchObject({
			id: 1,
			path: saved.path,
			name: "notes.zip",
		});

		// A second zip does not overwrite the first, and is a new download.
		const again = await machine.exportFolderZip("/notes");
		expect(again.path).not.toBe(saved.path);
		expect(machine.snapshot().files.exported?.id).toBe(2);
	});

	it("takes a folder, not a file", async () => {
		const { machine } = createMachine();
		await expect(machine.exportFolderZip("/notes/a.md")).rejects.toThrow(
			"is not a folder",
		);
	});

	it("takes pi code off the desktop while it is turned off, quitting it", async () => {
		const { machine } = createMachine();
		expect(machine.snapshot().builtInApps).toContain("pi");
		machine.openWindow("pi");
		expect(machine.findWindow("pi")).toBeDefined();

		machine.configure({ ...DEFAULT_MEMON_FEATURE_CONFIG, piCode: false });
		await vi.waitFor(() => expect(machine.findWindow("pi")).toBeUndefined());
		expect(machine.snapshot().builtInApps).toEqual([
			"scheduler",
			"studio",
			"skills",
			"connections",
		]);
		expect(() => machine.openWindow("pi")).toThrow(
			"pi code is turned off for this agent",
		);
		await expect(
			machine.piCode.act({ action: "prompt", text: "Build it" }),
		).rejects.toThrow("pi code is turned off for this agent");
	});

	it("picode opens pi code in the tab's folder, and the tab exits", async () => {
		const { ports } = createPorts();
		const piCode = fakePiCode();
		const machine = new MemonMachine("conversation-1", { ...ports, piCode });
		await machine.terminal.runCommand("cd /notes", { byUser: true });
		machine.terminal.openTab();
		expect(machine.snapshot().terminal.tabs.map((tab) => tab.id)).toEqual([
			"1",
			"2",
		]);

		await machine.terminal.runCommand("picode", {
			byUser: true,
			terminalId: "1",
		});
		expect(piCode.start).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/notes", sessionFile: undefined }),
		);
		// pi's window is in front, and tab 1 is gone.
		expect(machine.snapshot().focusedWindowId).toBe(
			machine.findWindow("pi")?.id,
		);
		expect(machine.snapshot().terminal.tabs.map((tab) => tab.id)).toEqual([
			"2",
		]);
		await vi.waitFor(() =>
			expect(machine.snapshot().piCode).toMatchObject({
				status: "running",
				cwd: "/notes",
			}),
		);

		// The agent's picode: in pi's own folder pi only comes up; the last
		// tab exits as `exit` does, cleared.
		await expect(
			runTerminalAction(machine.terminal, { command: "picode -c /notes" }),
		).resolves.toBe(
			'pi code was open in /notes already; it is in front. Terminal tab 2 exited. Hand pi work with memon_code { action: "prompt", text }.',
		);
		expect(piCode.start).toHaveBeenCalledTimes(1);
		expect(machine.snapshot().terminal.tabs.map((tab) => tab.id)).toEqual([
			"2",
		]);
		expect(machine.snapshot().terminal.lines).toEqual([]);
	});

	it("picode says in the tab what it cannot open, and the tab stays", async () => {
		const { ports } = createPorts();
		const piCode = fakePiCode();
		const machine = new MemonMachine("conversation-1", { ...ports, piCode });
		const run = async (command: string) => {
			const outcome = await machine.terminal.runCommand(command, {
				byUser: true,
			});
			return {
				exitCode: outcome.exitCode,
				said: machine.snapshot().terminal.lines.at(-1)?.text,
			};
		};

		await expect(run("picode /nope")).resolves.toEqual({
			exitCode: 1,
			said: "picode: /nope is not a folder.",
		});
		await expect(run("picode -x /notes")).resolves.toEqual({
			exitCode: 2,
			said: "  -c, --continue  open the folder's last pi session",
		});
		expect(machine.snapshot().terminal.lines.at(-4)?.text).toBe(
			"picode: unknown option -x",
		);
		machine.configure({ ...DEFAULT_MEMON_FEATURE_CONFIG, piCode: false });
		await expect(run("picode /notes")).resolves.toEqual({
			exitCode: 1,
			said: "picode: pi code is turned off for this agent. The user can turn it on in MemonOS Bot settings.",
		});
		expect(piCode.start).not.toHaveBeenCalled();
		expect(machine.findWindow("pi")).toBeUndefined();
		expect(machine.snapshot().terminal.tabs).toHaveLength(1);
	});

	it("opens pi code on its folder picker when the user opens it, listing the folders to go through", async () => {
		const { ports } = createPorts();
		const piCode = fakePiCode();
		const machine = new MemonMachine("conversation-1", { ...ports, piCode });
		machine.openWindow("pi");
		expect(machine.snapshot().piCode).toEqual({
			status: "choosing",
			working: false,
		});
		expect(machine.readScreen()).toContain(
			"pi code · the user picks a folder to open",
		);
		expect(piCode.start).not.toHaveBeenCalled();

		await expect(machine.browseFolders("/notes")).resolves.toEqual({
			dir: "/notes",
			parent: "/",
			folders: [],
			files: ["a.md"],
		});
		await expect(machine.browseFolders("/nope")).rejects.toThrow(
			"/nope is not a folder.",
		);

		// A new folder is made by pi as it starts; one that is there is refused.
		await expect(
			machine.openPiCode("/notes", { create: true }),
		).rejects.toThrow("/notes is already there.");
		await machine.openPiCode("/notes/app", { create: true });
		expect(piCode.start).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/notes/app" }),
		);
	});
});
