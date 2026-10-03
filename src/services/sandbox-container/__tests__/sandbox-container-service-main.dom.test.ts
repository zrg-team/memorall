import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxContainerInitOptions } from "../sandbox-container-service-main";
import {
	SandboxContainerServiceMain,
	ensureSandboxContainerMainReady,
	sandboxContainerMainService,
} from "../sandbox-container-service-main";
import type {
	SandboxCommandResult,
	SandboxExecutionResult,
	SandboxHandleSwRequestResult,
	SandboxOperation,
	SandboxOperationPayloadMap,
	SandboxOperationResultMap,
	SandboxRequestEnvelope,
} from "../types";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { logError } from "@/utils/logger";
import { runHostCommandLine } from "../host-commands";

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		applyChanges: vi.fn(async () => []),
		listEntries: vi.fn(async () => []),
		notifyExternalChange: vi.fn(),
		onFilesystemChanged: vi.fn(),
		readFile: vi.fn(),
		statEntry: vi.fn(async () => null),
		catchUp: vi.fn(async () => ({ head: 0, entries: [], complete: true })),
		ensureFresh: vi.fn(async () => undefined),
	},
}));

vi.mock("../host-commands", async (importOriginal) => ({
	...(await importOriginal<typeof import("../host-commands")>()),
	runHostCommandLine: vi.fn(),
}));

// The host's files open ZenFS; the host commands that use them are mocked.
vi.mock("../host-commands/host-files", () => ({
	createHostFiles: vi.fn(() => ({})),
}));

vi.mock("@/platform/current", () => ({
	platform: {
		environment: "extension",
		assets: {
			url: (path: string) =>
				(
					globalThis as typeof globalThis & {
						chrome: { runtime: { getURL: (path: string) => string } };
					}
				).chrome.runtime.getURL(path.replace(/^\//, "")),
		},
	},
}));

type ServiceUnderTest = Record<string, any>;

const encoded = (value: string): Uint8Array => new TextEncoder().encode(value);

const createService = (
	options: SandboxContainerInitOptions = { requestTimeoutMs: 25 },
): ServiceUnderTest =>
	new (
		SandboxContainerServiceMain as unknown as new (
			options?: SandboxContainerInitOptions,
		) => ServiceUnderTest
	)(options);

const installReadyIframe = (service: ServiceUnderTest) => {
	const sandboxWindow = { postMessage: vi.fn() };
	const iframe = {
		contentWindow: sandboxWindow,
		remove: vi.fn(),
	} as unknown as HTMLIFrameElement;
	service.iframe = iframe;
	service.initialized = true;
	service.initializedAt = 1_700_000_000_000;
	return { iframe, sandboxWindow };
};

/** The workspace sync, stubbed: workspace-sync's own tests cover it. */
const stubSync = (service: ServiceUnderTest) => {
	const sync = {
		ready: vi.fn(async (_roots?: string[]) => undefined),
		flush: vi.fn(async () => undefined),
		materialize: vi.fn(async (_paths: string[]) => true),
		notePending: vi.fn(),
		invalidate: vi.fn(),
		start: vi.fn(),
		dispose: vi.fn(),
		saveLocalTrees: vi.fn(async () => undefined),
	};
	service.workspaceSync = sync;
	return sync;
};

const captureLastRequest = (sandboxWindow: {
	postMessage: ReturnType<typeof vi.fn>;
}) => {
	const [request] = sandboxWindow.postMessage.mock.calls.at(-1) ?? [];
	return request as SandboxRequestEnvelope<SandboxOperation>;
};

const respondToRequest = <T extends SandboxOperation>(
	service: ServiceUnderTest,
	sandboxWindow: object,
	request: SandboxRequestEnvelope<T>,
	result: SandboxOperationResultMap[T],
) => {
	service.onMessage({
		source: sandboxWindow as unknown as MessageEventSource,
		data: {
			channel: "memorall-sandbox-container",
			direction: "response",
			requestId: request.requestId,
			operation: request.operation,
			ok: true,
			result,
		},
	});
};

const commandResult = (
	overrides: Partial<SandboxCommandResult> = {},
): SandboxCommandResult => ({
	commandId: "cmd-1",
	command: "npm test",
	cwd: "/app",
	status: "completed",
	completed: true,
	stdout: "",
	stderr: "",
	nextOffset: 0,
	startedAt: 1,
	updatedAt: 2,
	...overrides,
});

const executionResult = (
	overrides: Partial<SandboxExecutionResult> = {},
): SandboxExecutionResult => ({
	status: "ok",
	durationMs: 1,
	logs: [],
	truncatedLogs: 0,
	result: "done",
	...overrides,
});

const swResult = (
	overrides: Partial<SandboxHandleSwRequestResult> = {},
): SandboxHandleSwRequestResult => ({
	statusCode: 200,
	statusMessage: "OK",
	headers: {},
	bodyBase64: "",
	...overrides,
});

describe("SandboxContainerServiceMain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(globalThis, "chrome", {
			configurable: true,
			writable: true,
			value: {
				runtime: {
					getURL: vi.fn((path = "") => `chrome-extension://memorall/${path}`),
				},
			},
		});
		vi.mocked(documentFileSystemService.readFile).mockResolvedValue(
			encoded("file contents"),
		);
		vi.mocked(documentFileSystemService.onFilesystemChanged).mockReturnValue(
			vi.fn(),
		);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("posts sandbox requests, resolves matching responses, and rejects error envelopes", async () => {
		const service = createService();
		const { sandboxWindow } = installReadyIframe(service);

		const healthPromise = service.request("health", undefined);
		await Promise.resolve();
		const healthRequest = captureLastRequest(sandboxWindow);

		expect(healthRequest).toMatchObject({
			channel: "memorall-sandbox-container",
			direction: "request",
			operation: "health",
			payload: undefined,
		});

		service.onMessage({ source: {}, data: healthRequest });
		service.onMessage({
			source: sandboxWindow as unknown as MessageEventSource,
			data: { channel: "other", requestId: healthRequest.requestId },
		});
		respondToRequest(service, sandboxWindow, healthRequest, {
			ready: true,
			initializedAt: 1,
		});

		await expect(healthPromise).resolves.toEqual({
			ready: true,
			initializedAt: 1,
		});

		const failingPromise = service.request("runtime.clearLogs", undefined);
		await Promise.resolve();
		const failingRequest = captureLastRequest(sandboxWindow);
		service.onMessage({
			source: sandboxWindow as unknown as MessageEventSource,
			data: {
				channel: "memorall-sandbox-container",
				direction: "response",
				requestId: failingRequest.requestId,
				operation: failingRequest.operation,
				ok: false,
				error: { message: "boom" },
			},
		});

		await expect(failingPromise).rejects.toThrow(
			"Sandbox operation failed (runtime.clearLogs): boom",
		);
	});

	it("rejects a pending sandbox request on timeout", async () => {
		vi.useFakeTimers();
		const service = createService({ requestTimeoutMs: 10 });
		installReadyIframe(service);

		const promise = service.request("health", undefined);
		await Promise.resolve();
		const rejection = expect(promise).rejects.toThrow(
			"Sandbox request timed out (health) after 10ms",
		);
		await vi.advanceTimersByTimeAsync(11);
		await rejection;
	});

	it("maps public runtime, package, server, and snapshot methods to sandbox operations", async () => {
		const service = createService({ requestTimeoutMs: 40 });
		const sync = stubSync(service);
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: unknown) => {
				switch (operation as SandboxOperation) {
					case "runtime.executeCode":
						return executionResult() as never;
					case "runtime.runFile":
						return {
							...executionResult(),
							path: "/app/main.ts",
						} as never;
					case "runtime.executeCommand":
					case "runtime.listenCommand":
						return commandResult() as never;
					case "runtime.sendCommandInput":
						return { commandId: "cmd-1", sent: true } as never;
					case "runtime.stopCommand":
						return { commandId: "cmd-1", stopped: true } as never;
					case "runtime.listCommands":
						return { commands: [] } as never;
					case "runtime.createRepl":
						return { replId: "repl-1" } as never;
					case "runtime.replEval":
						return executionResult({ result: "4" }) as never;
					case "runtime.getLogs":
						return { logs: [] } as never;
					case "runtime.clearLogs":
						return { cleared: true } as never;
					case "network.fetch":
						return {
							url: "https://example.test",
							status: 200,
							ok: true,
							contentType: "text/plain",
							responseType: "text",
							body: "ok",
						} as never;
					case "npm.install":
					case "npm.installFromPackageJson":
						return { success: true, installed: { react: "19.1.1" } } as never;
					case "npm.list":
						return { packages: { react: "19.1.1" } } as never;
					case "server.request":
						return {
							port: 5173,
							url: "/",
							status: 200,
							ok: true,
							contentType: "text/html",
							responseType: "html",
							headers: {},
							body: "<main />",
						} as never;
					case "server.stop":
						return { port: 5173 } as never;
					case "server.list":
						return { servers: [] } as never;
					case "snapshot.get":
						return { snapshot: { files: [] } } as never;
					case "snapshot.restore":
						return { restored: true } as never;
					default:
						throw new Error(`unexpected operation ${operation}`);
				}
			});

		await expect(service.executeCode({ code: "1 + 1" })).resolves.toMatchObject(
			{
				status: "ok",
			},
		);
		await expect(
			service.runFile({ path: "workspaces/../app/main.ts" }),
		).resolves.toMatchObject({ path: "/app/main.ts" });
		await service.executeCommand({
			command: "npm test",
			cwd: "workspaces/app",
			waitTimeoutMs: 75,
		});
		await service.listenCommand({ commandId: "cmd-1", waitTimeoutMs: 10 });
		await service.sendCommandInput({ commandId: "cmd-1", input: "q" });
		await service.stopCommand({ commandId: "cmd-1" });
		await service.listCommands();
		await service.createRepl();
		await service.replEval({ replId: "repl-1", code: "2 + 2" });
		await service.getLogs({ limit: 5, level: "warn" });
		await service.clearLogs();
		await service.fetchResource({ url: "https://example.test" });
		await service.installPackage({ packageSpec: "react", save: true });
		await service.installFromPackageJson({ saveDev: true });
		await service.listInstalledPackages();
		await service.requestServer({ port: 5173, path: "/" });
		await service.stopServer({ port: 5173 });
		await service.listServers();
		await service.getSnapshot();
		await service.restoreSnapshot({ snapshot: { files: [] } });

		expect(request).toHaveBeenCalledWith("runtime.runFile", {
			path: "/app/main.ts",
		});
		expect(request).toHaveBeenCalledWith(
			"runtime.executeCommand",
			expect.objectContaining({ cwd: "/app" }),
			5075,
		);
		expect(request).toHaveBeenCalledWith(
			"server.request",
			{
				port: 5173,
				path: "/",
			},
			120_000,
		);
		// The command's own folder is in the runtime in full before it runs.
		expect(sync.ready).toHaveBeenCalledWith(["/app"]);
		// What the sandbox changed is saved after every run.
		expect(sync.flush).toHaveBeenCalledTimes(8);
		// A restore replaces the VFS: the next use fills it again.
		expect(sync.invalidate).toHaveBeenCalledTimes(1);
	});

	it("acts on the sandbox's files, kept in step with the host", async () => {
		const service = createService();
		const sync = stubSync(service);
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: unknown, payload: unknown) => {
				switch (operation as SandboxOperation) {
					case "fs.readFile":
						return {
							path: (payload as { path: string }).path,
							content: "ok",
						} as never;
					case "fs.readdir":
						return {
							path: (payload as { path: string }).path,
							entries: ["index.ts"],
						} as never;
					case "fs.exists":
						return {
							path: (payload as { path: string }).path,
							exists: true,
						} as never;
					default:
						return payload as never;
				}
			});

		await service.writeFile({
			path: "workspaces/app/../app/index.ts",
			content: "ts",
		});
		await expect(service.readFile({ path: "/app/index.ts" })).resolves.toEqual({
			path: "/app/index.ts",
			content: "ok",
		});
		await service.mkdir({ path: "/app/src", recursive: true });
		await service.readdir({ path: "/" });
		await service.unlink({ path: "/app/old.ts" });
		await service.rename({
			oldPath: "/app/old.ts",
			newPath: "workspaces/app/new.ts",
		});
		await service.exists({ path: "/app/new.ts" });

		expect(request).toHaveBeenCalledWith("fs.writeFile", {
			path: "/app/index.ts",
			content: "ts",
		});
		expect(request).toHaveBeenCalledWith("fs.rename", {
			oldPath: "/app/old.ts",
			newPath: "/app/new.ts",
		});
		// A read has the file's content, however large.
		expect(sync.ready).toHaveBeenCalledWith(["/app/index.ts"]);
		// Each change is saved on the host before the call returns.
		expect(sync.flush).toHaveBeenCalledTimes(4);
	});

	it("runs code again once a file it read before having it arrives", async () => {
		const service = createService();
		const sync = stubSync(service);
		const attempts = [
			executionResult({
				status: "error",
				error: "Workspace file not materialized: /data/big.csv",
			}),
			executionResult({ status: "ok", result: "loaded" }),
		];
		vi.spyOn(service, "request").mockImplementation(
			async () => attempts.shift() as never,
		);

		await expect(
			service.executeCode({ code: "read('/data/big.csv')" }),
		).resolves.toMatchObject({ status: "ok", result: "loaded" });
		expect(sync.materialize).toHaveBeenCalledWith(["/data/big.csv"]);
		expect(sync.flush).toHaveBeenCalledTimes(1);
	});

	it("retries SW requests once the missing file is sent, then serves it directly", async () => {
		const service = createService();
		const sync = stubSync(service);
		const missingBody = btoa("Workspace file not materialized: /app.js");
		let swAttempts = 0;
		vi.spyOn(service, "request").mockImplementation(async () => {
			swAttempts += 1;
			return swResult({
				statusCode: 404,
				statusMessage: "Not Found",
				headers: { "X-Transform-Error": "true" },
				bodyBase64: missingBody,
			}) as never;
		});
		vi.mocked(documentFileSystemService.readFile).mockResolvedValue(
			encoded("console.log('direct')"),
		);

		const result = await service.handleSwRequestWithRetry({
			id: 1,
			port: 5173,
			method: "GET",
			path: "/app.js",
			headers: {},
			body: null,
		});

		expect(swAttempts).toBe(2);
		expect(sync.materialize).toHaveBeenCalledWith(["/app.js"]);
		expect(result).toMatchObject({
			statusCode: 200,
			statusMessage: "OK",
			headers: expect.objectContaining({
				"Content-Type": "application/javascript; charset=utf-8",
				"X-Workspace-Direct-Fallback": "true",
			}),
		});
		expect(atob(result.bodyBase64)).toBe("console.log('direct')");
	});

	it("builds local server render URLs without remote dependency proxies", async () => {
		const service = createService();
		const sync = stubSync(service);
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: unknown, payload: unknown) => {
				switch (operation as SandboxOperation) {
					case "server.list":
						return {
							servers: [
								{
									kind: "vite",
									port: 5173,
									url: "http://localhost:5173",
									renderUrl: "/sandbox/__virtual__/5173/",
									rootDir: "/app",
								},
							],
						} as never;
					case "fs.readFile":
						return {
							path: "/app/package.json",
							content: JSON.stringify({
								dependencies: { react: "^19.1.1" },
								devDependencies: { "react-dom": "~19.1.1" },
							}),
						} as never;
					case "server.start":
						return {
							kind: "vite",
							port: 5173,
							url: "http://localhost:5173",
							renderUrl: "/sandbox/__virtual__/5173/",
							rootDir: "/app",
						} as never;
					default:
						return payload as never;
				}
			});

		const renderUrl = await service.getServerRenderUrl({
			port: 5173,
			path: "/preview",
		});
		const server = await service.startServer({
			port: 5173,
			rootDir: "/app",
			entryPath: "src/main.tsx",
		});

		expect(renderUrl.url).toContain("sandbox/pages/renderer.html");
		expect(decodeURIComponent(renderUrl.url)).not.toContain("__npm_proxy__");
		expect(request).toHaveBeenCalledWith(
			"server.start",
			expect.objectContaining({
				entryPath: "/app/src/main.tsx",
			}),
			60_000,
		);
		// The server's folder is in the runtime before it starts.
		expect(sync.ready).toHaveBeenCalledWith(["/app"]);
		expect(server.renderUrl).toBe(
			"chrome-extension://memorall/sandbox/__virtual__/5173/",
		);
	});

	it("saves the sandbox's changes shortly after the runtime says they wait", () => {
		const service = createService();
		const { sandboxWindow } = installReadyIframe(service);
		const sync = stubSync(service);

		service.onFsMessage({
			source: {} as MessageEventSource,
			data: { channel: "memorall-sandbox-fs-pending" },
		});
		expect(sync.notePending).not.toHaveBeenCalled();
		service.onFsMessage({
			source: sandboxWindow as unknown as MessageEventSource,
			data: { channel: "memorall-sandbox-fs-pending" },
		});
		expect(sync.notePending).toHaveBeenCalledTimes(1);
	});

	it("saves the sandbox's changes before git, py or curl read the host's files", async () => {
		const service = createService();
		const sync = stubSync(service);
		vi.mocked(runHostCommandLine).mockResolvedValue(commandResult());

		await service.executeCommand({ command: "git status", cwd: "/repo" });

		expect(sync.flush).toHaveBeenCalledTimes(1);
		expect(sync.flush.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(runHostCommandLine).mock.invocationCallOrder[0] ?? 0,
		);
		// And every other context's changes, so git reads the latest.
		expect(
			vi.mocked(documentFileSystemService.ensureFresh).mock
				.invocationCallOrder[0],
		).toBeLessThan(
			vi.mocked(runHostCommandLine).mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("saves before a runtime reset, then fills the next VFS afresh", async () => {
		const service = createService();
		const sync = stubSync(service);
		const request = vi
			.spyOn(service, "request")
			.mockResolvedValue({ reset: true } as never);

		await service.resetRuntime();

		expect(request).toHaveBeenCalledWith("runtime.reset", undefined);
		// Saved, then its node_modules and caches cached, then dropped.
		expect(sync.flush.mock.invocationCallOrder[0]).toBeLessThan(
			sync.saveLocalTrees.mock.invocationCallOrder[0] ?? 0,
		);
		expect(sync.saveLocalTrees.mock.invocationCallOrder[0]).toBeLessThan(
			sync.invalidate.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("syncs through the documents filesystem and moves contents with transfers", async () => {
		const service = createService();
		const request = vi
			.spyOn(service, "request")
			.mockResolvedValue({ changed: [], skipped: [], missing: [] } as never);
		const sync = service.workspaceSync as Record<string, any>;

		const buffer = new ArrayBuffer(4);
		const batch = {
			vfsId: "vfs-1",
			ops: [{ op: "write", path: "/a.txt", offset: 0, length: 4 }],
			buffer,
		};
		await sync.runtime.apply(batch);
		expect(request).toHaveBeenCalledWith("sync.apply", batch, 120_000, [
			buffer,
		]);

		await sync.files.apply(
			[{ op: "mkdir", path: "/app" }],
			undefined,
			"sandbox-sync",
		);
		expect(documentFileSystemService.applyChanges).toHaveBeenCalledWith(
			[{ op: "mkdir", path: "/app" }],
			undefined,
			"sandbox-sync",
		);
		await sync.files.list("/");
		expect(documentFileSystemService.listEntries).toHaveBeenCalledWith("/");
	});

	it("reports initialization failures through the exported ready helper", async () => {
		const initialize = vi
			.spyOn(sandboxContainerMainService, "initialize")
			.mockRejectedValueOnce(new Error("iframe missing"));

		await expect(ensureSandboxContainerMainReady()).rejects.toThrow(
			"iframe missing",
		);
		expect(logError).toHaveBeenCalledWith(
			"Failed to initialize SandboxContainerServiceMain",
			expect.any(Error),
		);

		initialize.mockRestore();
	});
});
