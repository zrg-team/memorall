import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";
import {
	DEFAULT_MEMON_FEATURE_CONFIG,
	type MemonFeatureConfig,
} from "../feature-config";
import type { MemonEmbeddedPort } from "../embedded-browser";
import {
	MemonApprovalRequiredError,
	MemonMachine,
	type MemonPorts,
	type MemonScheduleInput,
	normalizeBrowserUrl,
} from "../memon-machine";
import type { MemonStudioRequest } from "../studio-app";
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
			subscribe: vi.fn(() => () => undefined),
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

		await machine.runCommand("cd /notes");
		expect(ports.terminal.run).not.toHaveBeenCalled();
		await machine.runCommand("ls");

		expect(ports.terminal.run).toHaveBeenCalledWith("ls", {
			cwd: "/notes",
			waitMs: 400,
			sessionKey: "conversation-1",
		});
	});

	it("runs a cd chained with another command in the sandbox shell", async () => {
		const { machine, ports } = createMachine();

		await machine.runCommand("cd /notes/landing-page && node server.js");

		expect(ports.terminal.run).toHaveBeenCalledWith(
			"cd /notes/landing-page && node server.js",
			{ cwd: "/", waitMs: 400, sessionKey: "conversation-1" },
		);
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

		const run = machine.runCommand("node server.js", { waitMs: 500 });
		await vi.advanceTimersByTimeAsync(600);
		await run;
		expect(machine.servers).toEqual([3000]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(machine.snapshot().terminal.servers).toEqual([3000, 8080]);
		expect(machine.readScreen()).toContain(
			"serving http://localhost:3000, http://localhost:8080",
		);

		const stop = machine.stopCommand();
		await vi.advanceTimersByTimeAsync(3_100);
		await stop;
		expect(machine.servers).toEqual([]);
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
		await machine.runCommand("node stuck.js", { waitMs: 0 });
		expect(machine.currentCommand).toBe("node stuck.js");
		vi.mocked(ports.terminal.stop).mockRejectedValueOnce(
			new Error("Unknown process: gone"),
		);
		await machine.stopCommand();
		expect(machine.currentCommand).toBeNull();
		expect(machine.snapshot().terminal.lastExitCode).toBe(130);

		vi.mocked(ports.terminal.run).mockResolvedValueOnce({
			processId: "p2",
			running: true,
			exitCode: null,
			output: [],
		});
		await machine.runCommand("node stuck.js", { waitMs: 0 });
		const stop = machine.stopCommand();
		await vi.advanceTimersByTimeAsync(3_100);
		await stop;
		expect(machine.currentCommand).toBeNull();
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

	it("runs a curl line next to a running server, and nothing else", async () => {
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
			});
		vi.mocked(ports.terminal.read).mockImplementation(
			() => new Promise(() => undefined),
		);
		await machine.runCommand("node server.js", { waitMs: 0 });
		expect(machine.currentCommand).toBe("node server.js");

		const outcome = await machine.runCommand("curl -s localhost:3000/api");
		expect(outcome).toMatchObject({ alongside: true, exitCode: 0 });
		expect(ports.terminal.run).toHaveBeenLastCalledWith(
			"curl -s localhost:3000/api",
			expect.objectContaining({ cwd: "/" }),
		);
		expect(machine.currentCommand).toBe("node server.js");
		expect(
			machine.snapshot().terminal.lines.map((line) => line.text),
		).toContain('{"ok":true}');
		await expect(machine.runCommand("ls")).rejects.toThrow(
			"`node server.js` is still running in the Terminal.",
		);
	});

	it("puts the agent's install in front of the user and runs it once approved", async () => {
		const { machine, ports } = createMachine();

		const run = machine.runCommand("npm install zod");
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

		await machine.answerApproval(approval!.id, "approve");
		await expect(run).resolves.toMatchObject({ running: false, exitCode: 0 });
		expect(ports.terminal.run).toHaveBeenCalledTimes(1);
		expect(machine.snapshot().terminal.approval).toBeNull();
	});

	it("tells the agent when the user declines, waits, or stops the run", async () => {
		const { machine, ports } = createMachine({
			askBefore: { forms: true, installs: true, deletes: true },
		});

		const declined = machine.runCommand("rm -rf /notes", {});
		const declinedResult = expect(declined).rejects.toThrow(
			"The user declined to run `rm -rf /notes`.",
		);
		await vi.advanceTimersByTimeAsync(0);
		await machine.answerApproval(
			machine.snapshot().terminal.approval!.id,
			"deny",
		);
		await declinedResult;
		expect(machine.snapshot().terminal.approval).toBeNull();

		// Unanswered, the request stays for the user to run later.
		const unanswered = machine.runCommand("npm install zod");
		const unansweredResult = expect(unanswered).rejects.toBeInstanceOf(
			MemonApprovalRequiredError,
		);
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
		await unansweredResult;
		const waiting = machine.snapshot().terminal.approval;
		expect(waiting).toMatchObject({ agentWaiting: false });
		await machine.answerApproval(waiting!.id, "approve");
		expect(ports.terminal.run).toHaveBeenCalledWith(
			"npm install zod",
			expect.objectContaining({ cwd: "/" }),
		);

		const stopped = machine.runCommand("npm install lodash");
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

		const run = machine.runCommand("npm install -g pkg", {
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
		await expect(machine.runCommand("ls", { byUser: true })).rejects.toThrow(
			"`npm install -g pkg` is still running in the Terminal.",
		);

		await machine.sendCommandInput("y");
		expect(ports.terminal.input).toHaveBeenCalledWith(
			"p1",
			"y",
			"conversation-1",
		);
		expect(machine.readScreen()).toContain("> y");

		const stop = machine.stopCommand();
		await vi.advanceTimersByTimeAsync(1_500);
		await stop;
		expect(machine.waitForCommand(10)).resolves.toBe(true);
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
		machine.setAgent("agent-1");

		await machine.prepareDesktop();
		expect(machine.home).toBe("/.users/agent-1");
		expect(files.get("/.users/agent-1/Desktop/Bot.md")).toBe("Shared rules.");
		expect(files.get("/.users/agent-1/Desktop/Memory.md")).toContain(
			"# Memory.md",
		);
		expect(files.get("/Desktop/Bot.md")).toBe("Shared rules.");

		files.set("/.users/agent-1/Desktop/Bot.md", "Answer briefly.");
		await machine.prepareDesktop();
		expect(files.get("/.users/agent-1/Desktop/Bot.md")).toBe("Answer briefly.");
		expect(machine.snapshot().desktop.map((entry) => entry.name)).toEqual([
			"Bot.md",
			"Memory.md",
		]);
		expect(machine.readScreen()).toContain(
			"desktop (~/Desktop): Bot.md · Memory.md",
		);

		machine.setAgent("agent-2");
		await machine.prepareDesktop();
		expect(files.get("/.users/agent-2/Desktop/Bot.md")).toBe("Shared rules.");
		await machine.openFolder("~/Desktop");
		expect(machine.snapshot().files.cwd).toBe("/.users/agent-2/Desktop");
		expect(machine.readScreen()).toContain("Files · ~/Desktop");
	});

	it("tracks a checklist in Notes without taking the agent's focus", async () => {
		const { machine } = createMachine();
		await machine.openFolder("/notes");
		const filesWindow = machine.findWindow("files")?.id;

		machine.setNotes(["Search sources", "Read the top 3", "Write the report"]);
		machine.setNoteStatus(1, "done");
		machine.setNoteStatus(2, "doing");

		expect(machine.snapshot().focusedWindowId).toBe(filesWindow);
		let screen = machine.readScreen();
		expect(screen).toContain("notes: 1/3 done · now: Read the top 3");
		expect(screen).toContain("Notes · 1/3 done");

		machine.focusWindow(machine.findWindow("notes")!.id);
		machine.writeNotesText("Source: example.com");
		screen = machine.readScreen();
		expect(screen).toContain(
			'[x] 1. [n1] Wording: "Search sources" · [n2] Undo · [n3] Remove',
		);
		expect(screen).toContain(
			'[~] 2. [n4] Wording: "Read the top 3" · [n5] Done',
		);
		expect(screen).toContain('[ ] 3. [n7] Wording: "Write the report"');
		expect(screen).toContain("[n12] Notes:\n  | Source: example.com");
		expect(() => machine.setNoteStatus(9, "done")).toThrow(
			"Notes has no step 9; it has 3.",
		);
	});

	it("keeps Notes closed when the agent has no Planner", () => {
		const { machine } = createMachine({
			...DEFAULT_MEMON_FEATURE_CONFIG,
			apps: { ...DEFAULT_MEMON_FEATURE_CONFIG.apps, notes: false },
		});
		expect(() => machine.setNotes(["Plan"])).toThrow(
			"The notes app is turned off for this agent.",
		);
		expect(() => machine.openWindow("notes")).toThrow(
			"The notes app is turned off for this agent.",
		);
		expect(machine.findWindow("notes")).toBeUndefined();
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
				notes: true,
				visualize: false,
			},
		});

		const added = await machine.editDesktopFile("memory", {
			action: "add",
			text: "Prefers short answers",
		});
		expect(added.entries).toEqual(["Prefers short answers"]);
		expect(files.get("/.users/guest/Desktop/Memory.md")).toContain(
			"- Prefers short answers",
		);

		await machine.editDesktopFile("bot", {
			action: "add",
			text: "Always answer in Vietnamese",
		});
		const bot = await machine.editDesktopFile("bot", { action: "list" });
		expect(bot.entries).toEqual(["Always answer in Vietnamese"]);
		expect(files.get("/.users/guest/Desktop/Bot.md")).toContain("# Bot.md");
	});

	it("shows the agent's memory change in an open, saved Editor", async () => {
		const { machine, files } = createMachine();
		files.set("/.users/guest/Desktop/Memory.md", "# Memory.md\n");
		await machine.openFile("~/Desktop/Memory.md");

		await machine.editDesktopFile("memory", {
			action: "add",
			text: "Uses Edge",
		});

		expect(machine.snapshot().editor.content).toContain("- Uses Edge");
	});

	it("lets the agent use the Notes controls by their refs", async () => {
		const { machine } = createMachine();
		await expect(machine.actOnControl("n1", "click")).rejects.toThrow(
			"The notes window is not open",
		);
		machine.setNotes(["Search sources"]);
		machine.openWindow("notes");

		// n1 wording · n2 Done · n3 Remove · n4 new step · n5 Add
		await expect(machine.actOnControl("n5", "click")).rejects.toThrow(
			"Add is unavailable: type the step first.",
		);
		expect(await machine.actOnControl("n4", "type", "Write the report")).toBe(
			"",
		);
		expect(machine.snapshot().drafts["notes:new"]).toBe("Write the report");
		expect(await machine.actOnControl("n5", "click")).toBe(
			'added step "Write the report" to Notes',
		);
		expect(await machine.actOnControl("n2", "click")).toBe(
			'ticked step 1 "Search sources" in Notes',
		);
		expect(machine.snapshot().notes.items.map((item) => item.status)).toEqual([
			"done",
			"todo",
		]);
		await expect(machine.actOnControl("n2", "type", "x")).rejects.toThrow(
			"n2 is a button; click it.",
		);
		await expect(machine.actOnControl("n99", "click")).rejects.toThrow(
			"There is no n99 on the notes window now.",
		);
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
			{ sessionKey: "memon:conversation-1" },
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

		await machine.runCommand("node server.js", { waitMs: 0 });
		await machine.stopCommand();
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

		// Any local address opens embedded, server seen or not; a real tab
		// only when asked for.
		await machine.openUrl("localhost:4000");
		expect(embedded.open).toHaveBeenLastCalledWith("http://localhost:4000", {
			windowId: undefined,
		});
		expect(machine.snapshot().browser.tabs).toHaveLength(3);
		await machine.selectTab(2);
		await machine.openUrl("localhost:4000", { embedded: false });
		expect(ports.browser.navigate).toHaveBeenCalledWith(
			"s1",
			"http://localhost:4000",
		);

		await machine.selectTab(1);
		await machine.openUrl("http://localhost:3000/done", { embedded: true });
		expect(embedded.navigate).toHaveBeenCalledWith(
			"embedded-1",
			"http://localhost:3000/done",
		);
		await machine.showBrowserTab();
		expect(ports.browser.focus).not.toHaveBeenCalled();

		await machine.checkServers();
		machine.focusWindow(machine.openWindow("terminal").id);
		expect(machine.readScreen()).toContain(
			"serving http://localhost:3000 — a server keeps running",
		);
	});

	it("shows a visual, keeps it as a .openui file and opens it again", async () => {
		const { machine, files } = createMachine();
		machine.setAgent("agent-1");
		await expect(machine.showVisual('TextContent("no root")')).rejects.toThrow(
			"A visual starts with its root",
		);

		const report = [
			'root = CardBlock("Sales report", "Q3", [section_1])',
			'section_1 = TextContent("Up 12%")',
		].join("\n");
		const path = await machine.showVisual(report);
		expect(path).toBe("/.users/agent-1/Visuals/Sales report.openui");
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
		expect(files.get("/.users/agent-1/Visuals/Copy.openui")).toBe(
			`${report}\n`,
		);
		expect(await machine.showVisual(report)).toBe(
			"/.users/agent-1/Visuals/Sales report 2.openui",
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

	it("rewords a Notes step and refuses an empty one", () => {
		const { machine } = createMachine();
		machine.setNotes(["Serach sources"]);
		machine.editNote(1, "Search sources");
		expect(machine.snapshot().notes.items[0].text).toBe("Search sources");
		expect(() => machine.editNote(1, "  ")).toThrow("A step needs some text.");
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
				notes: true,
				visualize: false,
			},
		});
		await expect(machine.openUrl("https://example.com")).rejects.toThrow(
			/turned off/,
		);
	});
});
