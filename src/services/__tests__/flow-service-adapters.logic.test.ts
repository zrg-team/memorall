import { serviceRegistry } from "@memorall/agent-harness-flows/registries/service-registry";
import { describe, expect, it, vi } from "vitest";

// Two mapped folders in the states that produce a bare errno from the native
// layer: one mapped read-only, one that has gone away.
vi.mock("@/services/filesystem/native-folders/mount-registry", () => ({
	describeNativeMountProblem: (sandboxPath: string) => {
		if (sandboxPath.startsWith("/Photos")) {
			return 'The mapped folder "Photos" is mapped read-only, so it cannot be changed from here. Its files can still be read.';
		}
		if (sandboxPath.startsWith("/Archive")) {
			return 'The mapped folder "Archive" is not available right now. It may have been moved, renamed, unplugged, or had its permission revoked — re-map it from the Files view to restore access.';
		}
		return null;
	},
}));
import {
	registerFlowDatabase,
	registerFlowEmbedding,
	registerFlowFileSystem,
	registerFlowLLM,
	registerFlowSandbox,
	registerFlowWebBrowser,
	toFlowDatabase,
	toFlowEmbedding,
	toFlowFileSystem,
	toFlowLLM,
	toFlowSandbox,
	toFlowWebBrowser,
	withPromptCacheKey,
} from "../flow-service-adapters";

const text = new TextEncoder();

/**
 * A stand-in for `DocumentFileSystem`, including the part that matters most
 * here: mapped folders come out of `getTree` without their children, and it is
 * `resolveNode` that fills them in. The agent reads the filesystem through that
 * seam, so a fake without it hides the exact bug this file now guards.
 */
function makeFileSystemService(options: { mappedFolder?: boolean } = {}) {
	const files = new Map<string, Uint8Array>([
		["/notes/a.txt", text.encode("hello")],
	]);
	const mappedChildren = [
		{
			id: "m1",
			name: "design.md",
			path: "/mapped/design.md",
			type: "file" as const,
			isExpanded: false,
			file: { size: 12 },
			children: [],
		},
	];
	const lazyMapped = {
		id: "mapped",
		name: "mapped",
		path: "/mapped",
		type: "folder" as const,
		isExpanded: false,
		// Deferred: this is what the sidebar gets.
		children: [] as typeof mappedChildren,
		isLazy: true,
	};
	return {
		getFolderChildren: vi.fn(async (path: string) =>
			path === "/mapped" ? mappedChildren : [],
		),
		resolveNode: vi.fn(async (path: string) => {
			const tree = options.mappedFolder
				? [lazyMapped, ...baseTree()]
				: baseTree();
			if (path === "/") {
				return {
					id: "/",
					name: "",
					path: "/",
					type: "folder" as const,
					isExpanded: false,
					children: tree,
				};
			}
			if (path === "/mapped") {
				return { ...lazyMapped, children: mappedChildren, isLazy: false };
			}
			const find = (nodes: any[]): any => {
				for (const node of nodes) {
					if (node.path === path) return node;
					const hit = find(node.children ?? []);
					if (hit) return hit;
				}
				return null;
			};
			return find(tree);
		}),
		readFile: vi.fn(async (path: string) => files.get(path) ?? text.encode("")),
		writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
			files.set(path, bytes);
		}),
		deleteFile: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		deleteFolder: vi.fn(),
		mkdir: vi.fn(),
		move: vi.fn(
			async (_oldPath: string, newParent: string) => `${newParent}/a.txt`,
		),
		rename: vi.fn(),
		getTree: vi.fn(async () => baseTree()),
	};
}

function baseTree(): any[] {
	return [
		{
			id: "notes",
			name: "notes",
			path: "/notes",
			type: "folder",
			isExpanded: false,
			children: [
				{
					id: "a",
					name: "a.txt",
					path: "/notes/a.txt",
					type: "file",
					isExpanded: false,
					file: { size: 5 },
					children: [],
				},
			],
		},
	];
}

describe("flow service adapters", () => {
	it("adapts LLM and embedding services", async () => {
		const llmService = {
			chatCompletions: vi.fn(async () => ({ choices: [] })),
			models: vi.fn(async () => [{ id: "model-a" }]),
			isReady: vi.fn(() => true),
			getCurrentModel: vi.fn(() => "model-a"),
			getMaxModelTokens: vi.fn(() => 8192),
			getMaxResponseTokens: vi.fn(() => 1024),
		};
		const llm = toFlowLLM(llmService as any) as any;

		await expect(
			llm.chat?.completions.create({ messages: [] } as any),
		).resolves.toEqual({ choices: [] });
		await expect(llm.models?.list()).resolves.toEqual([{ id: "model-a" }]);
		expect(llm.isReady()).toBe(true);
		expect(llm.getCurrentModel()).toBe("model-a");
		expect(llm.getMaxModelTokens("model-a")).toBe(8192);
		expect(llm.getMaxResponseTokens("model-a")).toBe(1024);

		const embeddingService = {
			textToVector: vi.fn(async (input: string) => [input.length]),
			textsToVectors: vi.fn(async (inputs: string[]) =>
				inputs.map((input) => [input.length]),
			),
			isReady: vi.fn(() => true),
			get: vi.fn(async (name: string) => ({ name })),
		};
		const embedding = toFlowEmbedding(embeddingService as any) as any;

		await expect(
			embedding.embeddings.create({ input: "abc", model: "m" }),
		).resolves.toMatchObject({
			model: "m",
			data: [{ index: 0, embedding: [3] }],
		});
		await expect(
			embedding.embeddings.create({ input: ["a", "abcd"] }),
		).resolves.toMatchObject({
			data: [
				{ index: 0, embedding: [1] },
				{ index: 1, embedding: [4] },
			],
		});
		expect(await embedding.textToVector("xy")).toEqual([2]);
		expect(await embedding.textsToVectors(["xy"])).toEqual([[2]]);
		expect(await embedding.get("small")).toEqual({ name: "small" });
	});

	it("normalizes database raw responses and knowledge contexts", async () => {
		const raw = vi
			.fn()
			.mockResolvedValueOnce({ rows: [{ id: 1 }] })
			.mockResolvedValueOnce([{ id: 2 }])
			.mockResolvedValueOnce({ rows: [{ id: 3 }] });
		const service = {
			use: vi.fn((callback: any) => callback({ db: {}, schema: {}, raw })),
			transaction: vi.fn((callback: any) =>
				callback({ db: {}, schema: {}, raw }),
			),
		};
		const db = toFlowDatabase(service as any) as any;

		await expect(db.raw("select 1")).resolves.toEqual([{ id: 1 }]);
		await expect(db.knowledge.raw("select 2")).resolves.toEqual([{ id: 2 }]);
		await expect(
			db.knowledge.query((ctx: any) => ctx.raw("select 3")),
		).resolves.toEqual({ rows: [{ id: 3 }] });
		expect(await db.transaction((flowDb: any) => flowDb)).toBe(db);
		expect(() => db.collection("x" as never)).toThrow(/not implemented/);
	});

	/**
	 * The agent reads files through the same tree the sidebar draws, and mapped
	 * folders come out of that tree empty so the library can render before the
	 * OS has been walked. Resolving a path has to fill them in — when it did not,
	 * every mapped folder read as "exists, but empty (0 files)" to `fs_ls` and
	 * `fs_glob`, and the agent concluded the user's project was not there.
	 */
	it("sees inside a mapped folder the tree has not expanded yet", async () => {
		const service = makeFileSystemService({ mappedFolder: true });
		const fs = toFlowFileSystem(service as any);

		const entries = await fs.readdir("/mapped", { withFileTypes: true });

		expect(entries.map((entry) => entry.name)).toEqual(["design.md"]);
		expect(await fs.readdir("/mapped")).toEqual(["design.md"]);
	});

	/**
	 * A mapped folder has two failure modes nothing else in the library has: it
	 * can be read-only, and it can stop being there. Both arrive from the native
	 * layer as a bare errno, which tells the agent nothing it can act on — and
	 * "EACCES" on a folder the user deliberately mapped read-only reads like a
	 * bug rather than a setting.
	 */
	it("explains a read-only mapped folder instead of reporting EACCES", async () => {
		const service = makeFileSystemService();
		service.writeFile = vi.fn(async () => {
			throw Object.assign(new Error("EACCES: permission denied"), {
				code: "EACCES",
			});
		});
		const fs = toFlowFileSystem(service as any);

		await expect(fs.writeFile("/Photos/a.txt", "x")).rejects.toThrow(
			/mapped read-only/i,
		);
	});

	it("explains a disconnected mapped folder instead of reporting ENOENT", async () => {
		const service = makeFileSystemService();
		service.readFile = vi.fn(async () => {
			throw Object.assign(new Error("ENOENT: no such file"), {
				code: "ENOENT",
			});
		});
		const fs = toFlowFileSystem(service as any);

		await expect(fs.readFile("/Archive/a.txt")).rejects.toThrow(
			/not available right now/i,
		);
	});

	it("leaves ordinary failures exactly as they were", async () => {
		const service = makeFileSystemService();
		service.readFile = vi.fn(async () => {
			throw new Error("ENOENT: no such file");
		});
		const fs = toFlowFileSystem(service as any);

		// Nothing is mapped at /notes, so a missing file is still a missing file.
		await expect(fs.readFile("/notes/missing.txt")).rejects.toThrow(
			/^ENOENT: no such file$/,
		);
	});

	it("adapts document filesystem operations across document paths", async () => {
		const service = makeFileSystemService();
		const fs = toFlowFileSystem(service as any);

		await expect(
			fs.readFile("/notes/a.txt", { encoding: "utf-8" }),
		).resolves.toBe("hello");
		await fs.writeFile("/notes/b.txt", "new");
		await fs.appendFile("/notes/a.txt", " world");
		await expect(
			fs.readFile("/notes/a.txt", { encoding: "utf-8" }),
		).resolves.toBe("hello world");
		await expect(fs.readdir("/", { withFileTypes: true })).resolves.toEqual([
			expect.objectContaining({
				name: "notes",
				isDirectory: expect.any(Function),
			}),
		]);
		const stat = await fs.stat("/notes/a.txt");
		expect(stat.isFile()).toBe(true);
		expect(stat.size).toBe(5);
		await expect(fs.access("/notes/a.txt")).resolves.toBeUndefined();
		await expect(fs.rm("/notes", { recursive: false })).rejects.toThrow(
			/directory/,
		);
		await fs.rm("/notes", { recursive: true });
		await fs.copyFile("/notes/a.txt", "/notes/c.txt");
		await fs.rename("/notes/a.txt", "/archive/renamed.txt");

		expect(service.writeFile).toHaveBeenCalledWith(
			"/notes/b.txt",
			expect.any(Uint8Array),
		);
		expect(service.deleteFolder).toHaveBeenCalledWith("/notes");
		expect(service.move).toHaveBeenCalledWith("/notes/a.txt", "/archive");
		expect(service.rename).toHaveBeenCalledWith(
			"/archive/a.txt",
			"renamed.txt",
		);
	});

	it("adapts web browser and sandbox service calls", async () => {
		const webService = {
			isReady: vi.fn(() => true),
			openSession: vi.fn(async () => ({
				session: { id: "s1" },
				disposable: true,
				renderReady: false,
			})),
			refreshSession: vi.fn(async () => ({ id: "s1" })),
			getOrOpenSession: vi.fn(async () => ({ session: { id: "s2" } })),
			getAllSessionsInfo: vi.fn(async () => []),
			trimToLatestSession: vi.fn(async () => undefined),
			closeSession: vi.fn(async () => undefined),
			getActiveSessionInfo: vi.fn(async () => ({ id: "s1" })),
			fetchRenderedFallback: vi.fn(async () => ({ html: "<p>x</p>" })),
			searchInSessionHtml: vi.fn(async () => []),
			queryDomElements: vi.fn(async () => []),
			performDomAction: vi.fn(async () => ({ clicked: true })),
			waitForDomSelector: vi.fn(async () => ({ found: true })),
			waitForPageRender: vi.fn(async () => ({ renderReady: true })),
		};
		const web = toFlowWebBrowser(webService as any) as any;

		expect(web.getCapabilities()).toMatchObject({ canOpenSession: true });
		await expect(
			web.openSession({ url: "https://example.com" }),
		).resolves.toMatchObject({ session: { id: "s1" }, disposable: true });
		await expect(
			web.refreshSession({ sessionId: "s1" } as any),
		).resolves.toEqual({ id: "s1" });
		await expect(
			web.getOrOpenSession({ url: "https://example.com" }),
		).resolves.toMatchObject({ session: { id: "s2" }, disposable: false });
		await expect(
			web.performDomAction({ sessionId: "s1" } as any),
		).resolves.toEqual({ result: { clicked: true } });

		const sandboxService = {
			isReady: vi.fn(() => true),
			executeCode: vi.fn(async (request) => request),
			executeCommand: vi.fn(async () => ({ stdout: "ok", exitCode: 0 })),
			readFile: vi.fn(async (request) => request),
			writeFile: vi.fn(async (request) => request),
			readdir: vi.fn(async () => []),
			mkdir: vi.fn(async (request) => request),
			unlink: vi.fn(async (request) => request),
			rename: vi.fn(async (request) => request),
			exists: vi.fn(async () => true),
			installPackage: vi.fn(async (request) => request),
			startServer: vi.fn(async (request) => request),
			stopServer: vi.fn(async (request) => request),
			listServers: vi.fn(async () => []),
			clearLogs: vi.fn(async () => undefined),
			getLogs: vi.fn(async () => []),
			fetchResource: vi.fn(async () => ({ status: 200 })),
			listCommands: vi.fn(async () => []),
			listenCommand: vi.fn(async () => undefined),
			sendCommandInput: vi.fn(async () => ({ commandId: "cmd" })),
			stopCommand: vi.fn(async () => ({ commandId: "cmd" })),
			requestServer: vi.fn(async () => ({ port: 3000 })),
			getServerRenderUrl: vi.fn(async () => "http://localhost:3000"),
			handleSwRequestWithRetry: vi.fn(async () => ({ status: 200 })),
		};
		const sandbox = toFlowSandbox(sandboxService as any) as any;

		expect(sandbox.isReady()).toBe(true);
		await expect(sandbox.executeCode("console.log(1)" as any)).resolves.toEqual(
			{
				code: "console.log(1)",
			},
		);
		await expect(sandbox.executeCommand("ls")).resolves.toMatchObject({
			command: "ls",
			stdout: "ok",
			completed: true,
		});
		await sandbox.writeFile("/tmp/a.txt", "body");
		await sandbox.rename("/tmp/a.txt", "/tmp/b.txt");
		await expect(
			sandbox.sendCommandInput({ commandId: "cmd" } as any),
		).resolves.toEqual({ commandId: "cmd", sent: true });
		await expect(
			sandbox.stopCommand({ commandId: "cmd" } as any),
		).resolves.toEqual({ commandId: "cmd", stopped: true });
	});

	it("registers adapted services in the flow service registry", () => {
		const register = vi.spyOn(serviceRegistry, "registerInstance");

		registerFlowLLM({} as any);
		registerFlowFileSystem(makeFileSystemService() as any);
		registerFlowDatabase({ use: vi.fn(), transaction: vi.fn() } as any);
		registerFlowEmbedding({} as any);
		registerFlowWebBrowser({} as any);
		registerFlowSandbox({} as any);

		expect(register).toHaveBeenCalledWith("llm", expect.any(Object));
		expect(register).toHaveBeenCalledWith("fs", expect.any(Object));
		expect(register).toHaveBeenCalledWith("database", expect.any(Object));
		expect(register).toHaveBeenCalledWith("embedding", expect.any(Object));
		expect(register).toHaveBeenCalledWith("webBrowser", expect.any(Object));
		expect(register).toHaveBeenCalledWith(
			"sandboxContainer",
			expect.any(Object),
		);
		expect(register).toHaveBeenCalledWith("sandboxRuntime", expect.any(Object));
		register.mockRestore();
	});
});

describe("withPromptCacheKey", () => {
	const makeLLM = () => ({
		chatCompletions: vi.fn(async (body: unknown) => ({ body })),
		isReady: () => true,
		getCurrentModel: async () => null,
		getMaxModelTokens: async () => 1,
		getMaxResponseTokens: async () => 1,
		models: async () => ({ object: "list" as const, data: [] }),
	});

	it("stamps the conversation key on every request of the run", async () => {
		const llmService = makeLLM();
		const llm = withPromptCacheKey(
			toFlowLLM(llmService as any),
			"memorall:conversation:c1",
		);

		await llm.chatCompletions({ messages: [], model: "m" });
		await llm.chat?.completions.create({ messages: [], model: "m" });

		expect(llmService.chatCompletions).toHaveBeenCalledTimes(2);
		for (const [body] of llmService.chatCompletions.mock.calls) {
			expect(body).toMatchObject({
				model: "m",
				prompt_cache_key: "memorall:conversation:c1",
			});
		}
	});

	it("reaches OpenRouter as one sticky session across an agent loop", async () => {
		// End to end on the production path: the run's conversation key is
		// stamped here, passed through the real OpenAI-compatible client, and has
		// to arrive in the HTTP body as a `session_id`. Without it OpenRouter
		// spread one conversation over several upstream providers, each with its
		// own cache, and requests kept re-reading the whole prompt cold.
		const bodies: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: string | URL, init?: RequestInit) => {
				bodies.push(JSON.parse(String(init?.body ?? "{}")));
				return Response.json({
					id: "c",
					object: "chat.completion",
					created: 1,
					model: "deepseek/deepseek-v4.1",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "ok" },
							finish_reason: "stop",
						},
					],
				});
			}),
		);
		try {
			const { OpenAILLM } = await import(
				"@/services/llm/implementations/openai-llm"
			);
			const client = new OpenAILLM("key", "https://openrouter.ai/api/v1");
			const llm = withPromptCacheKey(
				toFlowLLM({
					...makeLLM(),
					chatCompletions: (body: any) => client.chatCompletions(body),
				} as any),
				"memorall:conversation:c1",
			);

			let messages: any[] = [{ role: "user", content: "Research my game" }];
			for (let step = 0; step < 3; step++) {
				await llm.chatCompletions({
					model: "deepseek/deepseek-v4.1",
					messages,
					stream: false,
				} as any);
				messages = [
					...messages,
					{ role: "assistant", content: `step ${step}` },
					{ role: "user", content: `continue ${step}` },
				];
			}

			expect(bodies).toHaveLength(3);
			expect(new Set(bodies.map((body) => body.session_id))).toEqual(
				new Set(["memorall:conversation:c1"]),
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps a key the step chose itself", async () => {
		const llmService = makeLLM();
		const llm = withPromptCacheKey(
			toFlowLLM(llmService as any),
			"memorall:conversation:c1",
		);

		await llm.chatCompletions({
			messages: [],
			model: "m",
			prompt_cache_key: "custom",
		});

		expect(llmService.chatCompletions).toHaveBeenCalledWith(
			expect.objectContaining({ prompt_cache_key: "custom" }),
		);
	});
});
