import { beforeEach, describe, expect, it, vi } from "vitest";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { SandboxContainerServiceProxy } from "../sandbox-container-service-proxy";
import type {
	SandboxCommandResult,
	SandboxExecutionResult,
	SandboxHandleSwRequestResult,
	SandboxOperation,
} from "../types";

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: {
		execute: vi.fn(),
	},
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFile: vi.fn(),
	},
}));

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

const encoded = (value: string): Uint8Array => new TextEncoder().encode(value);

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

const swResult = (
	overrides: Partial<SandboxHandleSwRequestResult> = {},
): SandboxHandleSwRequestResult => ({
	statusCode: 200,
	statusMessage: "OK",
	headers: {},
	bodyBase64: "",
	...overrides,
});

describe("SandboxContainerServiceProxy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(backgroundJob.execute).mockImplementation(
			async (_jobName, payload) => {
				const operation = (payload as { operation: SandboxOperation })
					.operation;
				return {
					jobId: "job-1",
					promise: Promise.resolve({
						status: "completed",
						progress: [],
						result: {
							operation,
							result: { ok: true },
						},
					}),
				};
			},
		);
	});

	it("initializes lazily, delegates requests to background jobs, and disposes state", async () => {
		const service = new SandboxContainerServiceProxy();

		expect(service.isReady()).toBe(false);
		await expect(service.request("health", undefined)).resolves.toEqual({
			ok: true,
		});
		expect(service.isReady()).toBe(true);
		expect(service.getInitializedAt()).toEqual(expect.any(Number));
		expect(backgroundJob.execute).toHaveBeenCalledWith(
			"sandbox-operation",
			{ operation: "health", payload: undefined },
			{ stream: false },
		);

		await service.dispose();
		expect(service.isReady()).toBe(false);
		expect(service.getInitializedAt()).toBeNull();
	});

	it("rejects invalid, failed, or mismatched background job responses", async () => {
		const service = new SandboxContainerServiceProxy();

		vi.mocked(backgroundJob.execute).mockResolvedValueOnce({} as never);
		await expect(service.request("health", undefined)).rejects.toThrow(
			"Expected promise result from non-streaming execute",
		);

		vi.mocked(backgroundJob.execute).mockResolvedValueOnce({
			jobId: "job-failed",
			promise: Promise.resolve({
				status: "failed",
				progress: [],
				error: "job failed",
			}),
		} as never);
		await expect(service.request("health", undefined)).rejects.toThrow(
			"job failed",
		);

		vi.mocked(backgroundJob.execute).mockResolvedValueOnce({
			jobId: "job-mismatch",
			promise: Promise.resolve({
				status: "completed",
				progress: [],
				result: { operation: "runtime.executeCode", result: {} },
			}),
		} as never);
		await expect(service.request("health", undefined)).rejects.toThrow(
			"Sandbox operation response mismatch: health",
		);
	});

	it("maps public methods to sandbox operation requests", async () => {
		const service = new SandboxContainerServiceProxy();
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: SandboxOperation) => {
				switch (operation) {
					case "runtime.executeCode":
					case "runtime.replEval":
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
					case "fs.writeFile":
					case "fs.mkdir":
					case "fs.unlink":
						return { path: "/app/file.ts" } as never;
					case "fs.readFile":
						return { path: "/app/file.ts", content: "ok" } as never;
					case "fs.readdir":
						return { path: "/app", entries: ["file.ts"] } as never;
					case "fs.rename":
						return {
							oldPath: "/app/old.ts",
							newPath: "/app/new.ts",
						} as never;
					case "fs.exists":
						return { path: "/app/file.ts", exists: true } as never;
					case "npm.install":
					case "npm.installFromPackageJson":
						return { success: true, installed: { react: "19.1.1" } } as never;
					case "npm.list":
						return { packages: { react: "19.1.1" } } as never;
					case "server.start":
						return {
							kind: "vite",
							port: 5173,
							url: "http://localhost:5173",
							renderUrl: "/render",
						} as never;
					case "server.stop":
						return { port: 5173 } as never;
					case "server.list":
						return { servers: [] } as never;
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
					case "server.renderUrl":
						return { port: 5173, url: "/render" } as never;
					case "snapshot.get":
						return { snapshot: {} } as never;
					case "snapshot.restore":
						return { restored: true } as never;
					default:
						return { reset: true } as never;
				}
			});

		await service.health();
		await service.resetRuntime();
		await service.executeCode({ code: "1 + 1" });
		await service.runFile({ path: "/app/main.ts" });
		await service.executeCommand({ command: "npm test" });
		await service.listenCommand({ commandId: "cmd-1" });
		await service.sendCommandInput({ commandId: "cmd-1", input: "q" });
		await service.stopCommand({ commandId: "cmd-1" });
		await service.listCommands();
		await service.createRepl();
		await service.replEval({ replId: "repl-1", code: "2 + 2" });
		await service.getLogs({ limit: 5 });
		await service.clearLogs();
		await service.fetchResource({ url: "https://example.test" });
		await service.writeFile({ path: "/app/file.ts", content: "ts" });
		await service.readFile({ path: "/app/file.ts" });
		await service.mkdir({ path: "/app" });
		await service.readdir({ path: "/app" });
		await service.unlink({ path: "/app/file.ts" });
		await service.rename({
			oldPath: "/app/old.ts",
			newPath: "/app/new.ts",
		});
		await service.exists({ path: "/app/file.ts" });
		await service.installPackage({ packageSpec: "react" });
		await service.installFromPackageJson();
		await service.listInstalledPackages();
		await service.startServer({ port: 5173 });
		await service.stopServer({ port: 5173 });
		await service.listServers();
		await service.requestServer({ port: 5173, path: "/" });
		await service.getServerRenderUrl({ port: 5173, path: "/" });
		await service.getSnapshot();
		await service.restoreSnapshot({ snapshot: {} });

		expect(request).toHaveBeenCalledWith("runtime.reset", undefined);
		expect(request).toHaveBeenCalledWith("npm.installFromPackageJson", {});
		expect(request).toHaveBeenCalledWith("server.renderUrl", {
			port: 5173,
			path: "/",
		});
	});

	it("materializes missing workspace files and returns a direct GET fallback", async () => {
		const service = new SandboxContainerServiceProxy();
		const missingBody = btoa(
			"Mounted file is not materialized in sandbox runtime: /app.js",
		);
		let handleAttempts = 0;
		const request = vi
			.spyOn(service, "request")
			.mockImplementation(async (operation: SandboxOperation, payload) => {
				if (operation === "fs.materializeDocumentFile") {
					return {
						path: (payload as { path: string }).path,
						materialized: true,
					} as never;
				}
				handleAttempts += 1;
				return swResult({
					statusCode: 500,
					statusMessage: "Internal Server Error",
					headers: { "X-Transform-Error": "true" },
					bodyBase64: missingBody,
				}) as never;
			});
		vi.mocked(documentFileSystemService.readFile).mockResolvedValue(
			encoded("console.log('proxy')"),
		);

		const result = await service.handleSwRequestWithRetry({
			id: 1,
			port: 5173,
			method: "GET",
			path: "/app.js",
			headers: {},
			body: null,
		});

		expect(handleAttempts).toBe(2);
		expect(request).toHaveBeenCalledWith("fs.materializeDocumentFile", {
			path: "/app.js",
			content: "console.log('proxy')",
		});
		expect(result).toMatchObject({
			statusCode: 200,
			headers: expect.objectContaining({
				"Content-Type": "application/javascript; charset=utf-8",
				"X-Workspace-Direct-Fallback": "true",
			}),
		});
		expect(atob(result.bodyBase64)).toBe("console.log('proxy')");
	});
});
