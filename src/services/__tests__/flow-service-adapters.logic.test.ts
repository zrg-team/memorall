import { describe, expect, it, vi } from "vitest";
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
} from "../flow-service-adapters";
import { serviceRegistry } from "../flows-core/registries/service-registry";

const text = new TextEncoder();

function makeFileSystemService() {
	const files = new Map<string, Uint8Array>([
		["/notes/a.txt", text.encode("hello")],
	]);
	return {
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
		getTree: vi.fn(async () => [
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
		]),
	};
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
