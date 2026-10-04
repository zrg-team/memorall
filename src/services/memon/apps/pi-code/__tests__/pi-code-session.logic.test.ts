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
import { PiCodeSession } from "../host/pi-code-session";

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
});
