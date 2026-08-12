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

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		deleteFile: vi.fn(),
		getSandboxMountSnapshot: vi.fn(),
		getSandboxWorkspaceMountSnapshot: vi.fn(),
		mkdir: vi.fn(),
		onFilesystemChanged: vi.fn(),
		readFile: vi.fn(),
		rename: vi.fn(),
		renamePath: vi.fn(),
		writeFile: vi.fn(),
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
		vi.mocked(
			documentFileSystemService.getSandboxMountSnapshot,
		).mockResolvedValue({
			directories: ["/"],
			files: ["/note.md"],
		});
		vi.mocked(
			documentFileSystemService.getSandboxWorkspaceMountSnapshot,
		).mockResolvedValue({
			directories: ["/"],
			files: ["/app/index.js"],
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
						return { ops: [] } as never;
				}
			});
		vi.spyOn(service, "syncDocumentsMount").mockResolvedValue(undefined);
		vi.spyOn(service, "syncWorkspaceMount").mockResolvedValue(undefined);
		vi.spyOn(service, "flushWorkspaceWrites").mockResolvedValue(undefined);

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
		expect(service.flushWorkspaceWrites).toHaveBeenCalledTimes(8);
	});

	it("normalizes filesystem operations and materializes workspace files before reads", async () => {
		const service = createService();
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
					case "fs.rename":
						return payload as never;
					default:
						return payload as never;
				}
			});
		vi.spyOn(service, "syncDocumentsMount").mockResolvedValue(undefined);
		vi.spyOn(service, "syncWorkspaceMount").mockResolvedValue(undefined);

		await service.writeFile({
			path: "workspaces/app/../app/index.ts",
			content: "ts",
		});
		await service.readFile({ path: "/note.md" });
		await service.readFile({ path: "/app/index.ts" });
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
		expect(request).toHaveBeenCalledWith("fs.materializeWorkspaceFile", {
			path: "/note.md",
			content: "file contents",
		});
		expect(request).toHaveBeenCalledWith("fs.materializeWorkspaceFile", {
			path: "/app/index.ts",
			content: "file contents",
		});
		expect(service.syncWorkspaceMount).toHaveBeenCalled();
		expect(service.syncDocumentsMount).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledWith("fs.rename", {
			oldPath: "/app/old.ts",
			newPath: "/app/new.ts",
		});
	});

	it("retries lazy execution when mounts or files must be materialized", async () => {
		const service = createService();
		const executionAttempts = [
			executionResult({
				status: "error",
				error: "Documents mount is not loaded in sandbox runtime",
			}),
			executionResult({
				status: "error",
				error: "Mounted file is not materialized in sandbox runtime: /note.md",
			}),
			executionResult({ status: "ok", result: "loaded" }),
		];
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: unknown) => {
				switch (operation as SandboxOperation) {
					case "runtime.executeCode":
						return executionAttempts.shift() as never;
					case "fs.mountDocuments":
						return { mounted: true, directoryCount: 1, fileCount: 1 } as never;
					case "fs.materializeDocumentFile":
						return { path: "/note.md", materialized: true } as never;
					case "fs.flushWorkspaceWrites":
						return {
							ops: [
								{
									op: "write",
									path: "/app/out.txt",
									content: "out",
								},
								{ op: "mkdir", path: "/app/generated" },
								{ op: "delete", path: "/app/old.txt" },
								{
									op: "rename",
									oldPath: "/app/tmp.txt",
									newPath: "/app/final.txt",
								},
							],
						} as never;
					default:
						throw new Error(`unexpected operation ${operation}`);
				}
			});

		await expect(
			service.executeCode({ code: "read('/note.md')" }),
		).resolves.toMatchObject({ status: "ok", result: "loaded" });

		expect(request).toHaveBeenCalledWith("fs.mountDocuments", {
			directories: ["/"],
			files: ["/note.md"],
		});
		expect(documentFileSystemService.writeFile).toHaveBeenCalledWith(
			"/app/out.txt",
			"out",
		);
		expect(documentFileSystemService.mkdir).toHaveBeenCalledWith(
			"/app/generated",
		);
		expect(documentFileSystemService.deleteFile).toHaveBeenCalledWith(
			"/app/old.txt",
		);
		expect(documentFileSystemService.rename).toHaveBeenCalledWith(
			"/app/tmp.txt",
			"final.txt",
		);
	});

	it("retries SW requests by materializing missing workspace files and serving direct fallbacks", async () => {
		const service = createService();
		const missingBody = btoa(
			"Mounted file is not materialized in sandbox runtime: /app.js",
		);
		let swAttempts = 0;
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: unknown, payload: unknown) => {
				if ((operation as SandboxOperation) === "fs.materializeDocumentFile") {
					return {
						path: (payload as { path: string }).path,
						materialized: true,
					} as never;
				}
				swAttempts += 1;
				return swResult({
					statusCode: 500,
					statusMessage: "Internal Server Error",
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
		expect(request).toHaveBeenCalledWith("fs.materializeDocumentFile", {
			path: "/app.js",
			content: "console.log('direct')",
		});
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
					case "fs.flushWorkspaceWrites":
						return { ops: [] } as never;
					default:
						return payload as never;
				}
			});
		vi.spyOn(service, "syncWorkspaceMount").mockResolvedValue(undefined);
		vi.spyOn(service, "materializeMountedWorkspaceFile").mockResolvedValue(
			true,
		);

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
		expect(server.renderUrl).toBe(
			"chrome-extension://memorall/sandbox/__virtual__/5173/",
		);
	});

	it("bridges sandbox VFS requests to the document filesystem service", async () => {
		const service = createService();
		const { sandboxWindow } = installReadyIframe(service);
		vi.spyOn(service, "request").mockResolvedValue({
			mounted: true,
			directoryCount: 1,
			fileCount: 1,
		} as never);

		service.onFsMessage({
			source: sandboxWindow as unknown as MessageEventSource,
			data: {
				channel: "memorall-sandbox-fs-req",
				requestId: "fs-1",
				operation: "fs.readFile",
				payload: { path: "/app/index.ts" },
			},
		});
		await vi.waitFor(() =>
			expect(sandboxWindow.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					channel: "memorall-sandbox-fs-res",
					requestId: "fs-1",
					ok: true,
					result: { content: "file contents" },
				}),
				"*",
			),
		);

		service.onFsMessage({
			source: sandboxWindow as unknown as MessageEventSource,
			data: {
				channel: "memorall-sandbox-fs-notify",
				operation: "fs.writeFile",
				payload: { path: "/app/out.txt", content: "saved" },
			},
		});
		await vi.waitFor(() =>
			expect(documentFileSystemService.writeFile).toHaveBeenCalledWith(
				"/app/out.txt",
				"saved",
			),
		);
	});

	it("bridges rename with exact source and destination paths", async () => {
		const service = createService();

		await expect(
			service.dispatchFsToDocumentService("fs.rename", {
				oldPath: "/app/src/old.ts",
				newPath: "/app/generated/new.ts",
			}),
		).resolves.toEqual({
			oldPath: "/app/src/old.ts",
			newPath: "/app/generated/new.ts",
		});
		expect(documentFileSystemService.renamePath).toHaveBeenCalledWith(
			"/app/src/old.ts",
			"/app/generated/new.ts",
		);
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
