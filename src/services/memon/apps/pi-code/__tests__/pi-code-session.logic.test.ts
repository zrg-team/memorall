import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type {
	DirEntry,
	FileStat,
	IFlowFileSystem,
} from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
} from "@/types/openai";
import { meterLlmService } from "@/services/model-usage/metered-llm";
import type { ModelUsageEntry } from "@/services/model-usage/model-usage-ledger";
import type { AgentMessage } from "../agent";
import { PiCodeSession } from "../host/pi-code-session";
import { buildTranscript } from "../host/transcript";

const HOME = "/agents/coder";

const stat = (isFile: boolean, size = 0): FileStat => ({
	isFile: () => isFile,
	isDirectory: () => !isFile,
	isSymbolicLink: () => false,
	size,
	mtime: new Date(0),
	atime: new Date(0),
	ctime: new Date(0),
	birthtime: new Date(0),
	mode: 0,
});

/** Files by absolute path; folders are every parent of a file, plus mkdir'd ones. */
class MemoryFs implements IFlowFileSystem {
	readonly files = new Map<string, Uint8Array>();
	private dirs = new Set<string>(["/"]);

	constructor(files: Record<string, string>) {
		for (const [path, text] of Object.entries(files)) this.put(path, text);
	}

	private put(path: string, data: string | Uint8Array) {
		this.files.set(
			path,
			typeof data === "string" ? new TextEncoder().encode(data) : data,
		);
		const parts = path.split("/").filter(Boolean);
		for (let i = 0; i < parts.length; i++)
			this.dirs.add(
				`/${parts.slice(0, i).join("/")}`.replace(/\/$/, "") || "/",
			);
	}

	text(path: string): string | undefined {
		const bytes = this.files.get(path);
		return bytes && new TextDecoder().decode(bytes);
	}

	readFile(path: string): Promise<Uint8Array>;
	readFile(path: string, options: { encoding: "utf8" }): Promise<string>;
	async readFile(
		path: string,
		options?: { encoding: string },
	): Promise<string | Uint8Array> {
		const bytes = this.files.get(path);
		if (!bytes) throw new Error(`ENOENT: ${path}`);
		return options?.encoding ? new TextDecoder().decode(bytes) : bytes;
	}
	async writeFile(path: string, data: string | Uint8Array) {
		this.put(path, data);
	}
	async appendFile(path: string, data: string | Uint8Array) {
		const current = this.text(path) ?? "";
		this.put(
			path,
			current +
				(typeof data === "string" ? data : new TextDecoder().decode(data)),
		);
	}
	async unlink(path: string) {
		this.files.delete(path);
	}
	async rename(from: string, to: string) {
		this.put(to, await this.readFile(from));
		this.files.delete(from);
	}
	async copyFile(from: string, to: string) {
		this.put(to, await this.readFile(from));
	}
	async mkdir(path: string) {
		const parts = path.split("/").filter(Boolean);
		for (let i = 1; i <= parts.length; i++)
			this.dirs.add(`/${parts.slice(0, i).join("/")}`);
		return undefined;
	}
	async rmdir() {}
	async rm(path: string) {
		this.files.delete(path);
	}
	readdir(path: string): Promise<string[]>;
	readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
	async readdir(
		path: string,
		options?: { withFileTypes: true },
	): Promise<string[] | DirEntry[]> {
		if (!this.dirs.has(path)) throw new Error(`ENOENT: ${path}`);
		const prefix = path === "/" ? "/" : `${path}/`;
		const names = new Map<string, boolean>();
		for (const file of this.files.keys()) {
			if (!file.startsWith(prefix)) continue;
			const rest = file.slice(prefix.length);
			const [name, ...more] = rest.split("/");
			names.set(name, more.length > 0 || names.get(name) === true);
		}
		for (const dir of this.dirs) {
			if (
				dir !== path &&
				dir.startsWith(prefix) &&
				!dir.slice(prefix.length).includes("/")
			) {
				names.set(dir.slice(prefix.length), true);
			}
		}
		if (!options) return [...names.keys()];
		return [...names].map(([name, isDir]) => ({
			name,
			isFile: () => !isDir,
			isDirectory: () => isDir,
			isSymbolicLink: () => false,
		}));
	}
	async stat(path: string) {
		if (this.files.has(path)) return stat(true, this.files.get(path)?.length);
		if (this.dirs.has(path)) return stat(false);
		throw new Error(`ENOENT: ${path}`);
	}
	async access(path: string) {
		await this.stat(path);
	}
}

const chunk = (
	delta: ChatCompletionChunk["choices"][0]["delta"],
	finish: string | null = null,
): ChatCompletionChunk => ({
	id: "c1",
	object: "chat.completion.chunk",
	created: 0,
	model: "test-model",
	choices: [
		{
			index: 0,
			delta,
			finish_reason:
				finish as ChatCompletionChunk["choices"][0]["finish_reason"],
		},
	],
});

/** A chat model that edits the file once, then answers. */
const createLlm = (requests: ChatCompletionRequest[]): ILLMService =>
	({
		getCurrentModel: async () => ({
			modelId: "test-model",
			provider: "openai",
			serviceName: "openai",
		}),
		modelsFor: async () => ({
			object: "list",
			data: [{ id: "test-model", name: "Test Model" }],
		}),
		getMaxModelTokensFor: async () => 64_000,
		getMaxResponseTokensFor: async () => 4_096,
		onCurrentModelChange: () => () => {},
		chatCompletionsFor: (_name: string, request: ChatCompletionRequest) => {
			requests.push(request);
			const last = request.messages[request.messages.length - 1];
			return (async function* () {
				if (last.role === "tool") {
					yield chunk({ content: "Done: " });
					yield chunk({ content: "the answer is 42." });
					yield {
						...chunk({}, "stop"),
						usage: {
							prompt_tokens: 1200,
							completion_tokens: 30,
							total_tokens: 1230,
						},
					};
					return;
				}
				const args = JSON.stringify({
					path: "src/a.ts",
					edits: [{ oldText: "41", newText: "42" }],
				});
				yield chunk({
					tool_calls: [
						{
							index: 0,
							id: "call_1",
							type: "function",
							function: { name: "edit", arguments: "" },
						},
					],
				});
				yield chunk({
					tool_calls: [
						{ index: 0, function: { arguments: args.slice(0, 20) } },
					],
				});
				yield chunk({
					tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }],
				});
				yield chunk({}, "tool_calls");
			})();
		},
	}) as unknown as ILLMService;

const createSandbox = (commands: string[]): IAgentSandboxService =>
	({
		run: async (request: { command: string }) => {
			commands.push(request.command);
			return {
				kind: "command",
				processId: "p1",
				command: request.command,
				cwd: HOME,
				status: "completed",
				completed: true,
				events: [
					{ type: "stdout", text: "hello from the sandbox\n", timestamp: 0 },
				],
				nextCursor: "1",
				exitCode: 0,
				startedAt: 0,
				updatedAt: 0,
			};
		},
		process: async () => ({ processId: "p1", stopped: true }),
	}) as unknown as IAgentSandboxService;

/** Plain screen text: escape sequences dropped. */
const plain = (text: string) =>
	text.replace(
		/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b_[^\x07]*\x07/g,
		"",
	);

describe("PiCodeSession", () => {
	let session: PiCodeSession | undefined;
	afterEach(async () => {
		await session?.dispose();
		session = undefined;
	});

	it("runs pi's agent with the chat model on the Memon files and shows it in the TUI", async () => {
		const fs = new MemoryFs({
			[`${HOME}/AGENTS.md`]: "Always use tabs.",
			[`${HOME}/src/a.ts`]: "export const answer = 41;\n",
		});
		const requests: ChatCompletionRequest[] = [];
		const quit = vi.fn();
		session = await PiCodeSession.start({
			home: HOME,
			sandboxSessionKey: "memon:test",
			theme: "dark",
			columns: 100,
			rows: 30,
			fs,
			getSandbox: async () => createSandbox([]),
			getLlm: async () => createLlm(requests),
			onQuit: quit,
			onChange: () => {},
		});

		const cursor = session.attach(100, 30, "dark");
		session.input("fix the answer\r");

		await vi.waitFor(
			() => {
				expect(fs.text(`${HOME}/src/a.ts`)).toBe("export const answer = 42;\n");
				expect(session?.status().running).toBe(false);
			},
			{ timeout: 5_000 },
		);
		const { data } = await session.read(cursor, 0);
		const screen = plain(data);
		expect(screen).toContain("fix the answer");
		expect(screen).toContain("edit");
		expect(screen).toContain("src/a.ts");
		expect(screen).toContain("Done: the answer is 42.");
		expect(screen).toContain("test-model");

		// pi's system prompt, tools and context file went to the chat model.
		expect(requests).toHaveLength(2);
		const system = requests[0].messages[0];
		expect(system.role).toBe("system");
		expect(String(system.content)).toContain("operating inside pi");
		expect(String(system.content)).toContain("Always use tabs.");
		expect(String(system.content)).toContain(
			`Current working directory: ${HOME}`,
		);
		expect(requests[0].tools?.map((tool) => tool.function.name)).toEqual([
			"read",
			"bash",
			"edit",
			"write",
		]);
		expect(requests[1].messages.at(-1)).toMatchObject({
			role: "tool",
			tool_call_id: "call_1",
		});
		expect(session.status().model).toBe("openai/test-model");
		expect(quit).not.toHaveBeenCalled();
	});

	it("runs ! commands in the sandbox and quits on Ctrl+D", async () => {
		const fs = new MemoryFs({ [`${HOME}/Bot.md`]: "# Bot" });
		const commands: string[] = [];
		const quit = vi.fn();
		session = await PiCodeSession.start({
			home: HOME,
			sandboxSessionKey: "memon:test",
			theme: "light",
			fs,
			getSandbox: async () => createSandbox(commands),
			getLlm: async () => createLlm([]),
			onQuit: quit,
			onChange: () => {},
		});
		const cursor = session.attach(90, 24);
		session.input("!echo hi\r");
		await vi.waitFor(() => expect(commands).toEqual(["echo hi"]), {
			timeout: 5_000,
		});
		await vi.waitFor(
			async () =>
				expect(plain((await session!.read(cursor, 0)).data)).toContain(
					"hello from the sandbox",
				),
			{ timeout: 5_000 },
		);

		session.input("\x04");
		await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1), {
			timeout: 2_000,
		});
	});

	it("takes the Memon agent's prompt in a new folder, reports its conversation and leaves the user's draft", async () => {
		const fs = new MemoryFs({
			[`${HOME}/todo/src/a.ts`]: "export const answer = 41;\n",
		});
		const changes = vi.fn();
		session = await PiCodeSession.start({
			home: HOME,
			cwd: `${HOME}/todo`,
			sandboxSessionKey: "memon:test",
			theme: "dark",
			fs,
			getSandbox: async () => createSandbox([]),
			getLlm: async () => createLlm([]),
			onQuit: () => {},
			onChange: changes,
		});
		const cursor = session.attach(100, 30);
		// The user is typing something of their own.
		session.input("my own draft");

		await session.submit("fix the answer");
		expect(await session.waitForIdle(5_000)).toBe(true);
		expect(fs.text(`${HOME}/todo/src/a.ts`)).toBe(
			"export const answer = 42;\n",
		);
		const view = session.view();
		expect(view.entries).toEqual([
			{ kind: "user", text: "fix the answer" },
			{
				kind: "tool",
				name: "edit",
				text: "src/a.ts → Successfully replaced 1 block(s) in src/a.ts.",
			},
			{ kind: "assistant", text: "Done: the answer is 42." },
		]);
		expect(view.earlier).toBe(0);
		expect(view.ended).toBe("done");
		expect(view.reply).toBe("Done: the answer is 42.");
		expect(view.queued).toEqual([]);
		expect(view.activity).toBeUndefined();
		expect(changes).toHaveBeenCalled();
		// The draft is still in pi's editor.
		await vi.waitFor(async () =>
			expect(plain((await session!.read(cursor, 0)).data)).toContain(
				"my own draft",
			),
		);

		// A prompt pi cannot take comes back to the caller.
		await session.dispose();
		await expect(session.submit("again")).rejects.toThrow("pi code has quit.");
	});

	it("lists every folder's saved sessions and opens them again, one after another", async () => {
		const fs = new MemoryFs({
			[`${HOME}/todo/src/a.ts`]: "export const answer = 41;\n",
			"/projects/game/src/a.ts": "export const answer = 41;\n",
		});
		const options = {
			home: HOME,
			cwd: `${HOME}/todo`,
			sandboxSessionKey: "memon:test",
			theme: "dark" as const,
			fs,
			getSandbox: async () => createSandbox([]),
			getLlm: async () => createLlm([]),
			onQuit: () => {},
			onChange: () => {},
		};
		// One session here, one in a folder outside the home.
		for (const [cwd, prompt] of [
			[`${HOME}/todo`, "fix the answer"],
			["/projects/game", "fix the game"],
		]) {
			const earlier = await PiCodeSession.start({ ...options, cwd });
			expect(earlier.createdCwd).toBe(false);
			await earlier.submit(prompt);
			expect(await earlier.waitForIdle(5_000)).toBe(true);
			await earlier.dispose();
		}

		const onResume = vi.fn();
		session = await PiCodeSession.start({ ...options, onResume });
		const cursor = session.attach(100, 40);
		session.input("/sessions\r");
		// This folder first, then the others, numbered across them.
		await vi.waitFor(async () => {
			const screen = plain((await session!.read(cursor, 0)).data);
			expect(screen).toContain("~/todo (this folder)");
			expect(screen).toContain("1. fix the answer");
			expect(screen).toContain("/projects/game");
			expect(screen).toContain("2. fix the game");
		});
		session.input("/resume 2\r");
		await vi.waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
		const [game, gameFolder] = onResume.mock.calls[0];
		expect(String(game)).toMatch(/--projects-game--\/.+\.jsonl$/);
		expect(gameFolder).toBe("/projects/game");
		await session.dispose();

		// Opened in its own folder, pi goes on from that conversation...
		session = await PiCodeSession.start({
			...options,
			cwd: gameFolder,
			sessionFile: game,
			onResume,
		});
		expect(session.cwd).toBe("/projects/game");
		expect(session.view().entries).toContainEqual({
			kind: "user",
			text: "fix the game",
		});
		expect(session.view().reply).toBe("Done: the answer is 42.");
		// ...and resumes again from there, back into the home's folder.
		session.attach(100, 40);
		session.input("/resume 2\r");
		await vi.waitFor(() => expect(onResume).toHaveBeenCalledTimes(2));
		const [todo, todoFolder] = onResume.mock.calls[1];
		expect(todoFolder).toBe(`${HOME}/todo`);
		await session.dispose();
		session = await PiCodeSession.start({
			...options,
			sessionFile: todo,
			onResume,
		});
		expect(session.view().entries).toContainEqual({
			kind: "user",
			text: "fix the answer",
		});
		await session.dispose();

		// A folder that was not there is made, and said so.
		session = await PiCodeSession.start({ ...options, cwd: `${HOME}/fresh` });
		expect(session.createdCwd).toBe(true);
	});

	it("books each pi request to its own session, with two computers running pi", async () => {
		const booked: ModelUsageEntry[] = [];
		const record = async (entry: ModelUsageEntry) => {
			booked.push(entry);
		};
		const sessions: Record<"A" | "B", PiCodeSession | undefined> = {
			A: undefined,
			B: undefined,
		};
		const requests = {
			A: [] as ChatCompletionRequest[],
			B: [] as ChatCompletionRequest[],
		};
		const start = (name: "A" | "B") => {
			const llm = meterLlmService(
				createLlm(requests[name]),
				() => ({
					source: "pi-code",
					tool: "memon_code",
					sessionId: sessions[name]?.sessionId ?? name,
					title: name,
				}),
				record,
			);
			return PiCodeSession.start({
				home: HOME,
				sandboxSessionKey: `memon:${name}`,
				theme: "dark",
				fs: new MemoryFs({
					[`${HOME}/src/a.ts`]: "export const answer = 41;\n",
				}),
				getSandbox: async () => createSandbox([]),
				getLlm: async () => llm,
				onQuit: () => {},
				onChange: () => {},
			});
		};
		sessions.A = await start("A");
		sessions.B = await start("B");
		try {
			for (const name of ["B", "A"] as const) {
				await sessions[name]?.submit("fix the answer");
				expect(await sessions[name]?.waitForIdle(5_000)).toBe(true);
			}
			expect(requests.A).toHaveLength(2);
			expect(requests.B).toHaveLength(2);
			for (const name of ["A", "B"] as const) {
				const mine = booked.filter((entry) => entry.title === name);
				expect(mine.map((entry) => entry.sessionId)).toEqual([
					sessions[name]?.sessionId,
					sessions[name]?.sessionId,
				]);
				// The tool call reported no usage (estimated); the answer did.
				expect(mine.map((entry) => entry.usage)).toEqual([
					expect.objectContaining({ estimated: true }),
					expect.objectContaining({
						prompt_tokens: 1200,
						completion_tokens: 30,
					}),
				]);
			}
		} finally {
			await sessions.A?.dispose();
			await sessions.B?.dispose();
		}
	});

	it("restarts the output at a full redraw for a view that attaches late", async () => {
		const fs = new MemoryFs({ [`${HOME}/Bot.md`]: "# Bot" });
		session = await PiCodeSession.start({
			home: HOME,
			sandboxSessionKey: "memon:test",
			theme: "dark",
			fs,
			getSandbox: async () => createSandbox([]),
			getLlm: async () => createLlm([]),
			onQuit: () => {},
			onChange: () => {},
		});
		const first = session.attach(80, 24);
		await vi.waitFor(async () =>
			expect(plain((await session!.read(first, 0)).data)).toContain("pi"),
		);
		const second = session.attach(120, 40);
		expect(second).toBeGreaterThan(first);
		// The first view's cursor is out of date now: it is told to reset.
		const stale = await session.read(first, 0);
		expect(stale.reset).toBe(true);
		await vi.waitFor(async () => {
			const fresh = await session!.read(second, 0);
			expect(fresh.reset).toBe(false);
			expect(fresh.data).toContain("\x1b[2J");
		});
	});

	it("saves a pasted picture in pi's temp folder and pastes its path after the user's text", async () => {
		const fs = new MemoryFs({ [`${HOME}/Bot.md`]: "# Bot" });
		session = await PiCodeSession.start({
			home: HOME,
			sandboxSessionKey: "memon:test",
			theme: "dark",
			columns: 120,
			rows: 30,
			fs,
			getSandbox: async () => createSandbox([]),
			getLlm: async () => createLlm([]),
			onQuit: () => {},
			onChange: () => {},
		});
		const cursor = session.attach(120, 30);
		session.input("what is in");
		const picture = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		await session.pasteImage(picture, "image/png");

		const saved = [...fs.files.keys()].filter((path) =>
			path.startsWith(`${HOME}/.pi/agent/tmp/pi-clipboard-`),
		);
		expect(saved).toHaveLength(1);
		expect(saved[0]).toMatch(/\.png$/);
		expect(fs.files.get(saved[0])).toEqual(picture);
		const shown = saved[0].replace(HOME, "~");
		await vi.waitFor(async () =>
			expect(plain((await session!.read(cursor, 0)).data)).toContain(
				`what is in ${shown}`,
			),
		);
	});
});

describe("pi's transcript, as the agent reads how a turn ended", () => {
	const reply = (
		text: string,
		stopReason: "stop" | "toolUse" | "error" | "aborted",
	) =>
		({
			role: "assistant",
			content: text ? [{ type: "text", text }] : [],
			stopReason,
			errorMessage: stopReason === "error" ? "rate limited" : undefined,
		}) as unknown as AgentMessage;
	const ask = { role: "user", content: "fix it" } as unknown as AgentMessage;

	it("tells an answer, an error and a stop apart, and only a finished reply counts", () => {
		expect(buildTranscript([])).toEqual({
			entries: [],
			earlier: 0,
			ended: undefined,
			reply: undefined,
		});
		expect(
			buildTranscript([ask, reply("Sessions or JWT?", "stop")]),
		).toMatchObject({ ended: "done", reply: "Sessions or JWT?" });
		expect(
			buildTranscript([
				ask,
				reply("Earlier answer", "stop"),
				ask,
				reply("", "error"),
			]),
		).toMatchObject({ ended: "error", reply: undefined });
		expect(buildTranscript([ask, reply("", "aborted")])).toMatchObject({
			ended: "stopped",
		});
		// Still streaming: the last finished turn is what counts.
		expect(
			buildTranscript(
				[ask, reply("Done.", "stop"), ask],
				reply("Working on", "stop"),
			),
		).toMatchObject({ ended: "done", reply: "Done." });
	});
});
