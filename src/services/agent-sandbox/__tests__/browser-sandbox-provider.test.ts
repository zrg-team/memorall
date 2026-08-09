import { describe, expect, it, vi } from "vitest";
import { BrowserSandboxProvider } from "../browser-sandbox-provider";
import { expectSandboxProviderConformance } from "./provider-conformance";

const now = 1_700_000_000_000;

const command = (overrides: Record<string, unknown> = {}) => ({
	commandId: "command-1",
	command: "echo ok",
	cwd: "/projects/app",
	status: "completed" as const,
	completed: true,
	stdout: "ok",
	stderr: "",
	nextOffset: 2,
	exitCode: 0,
	startedAt: now,
	updatedAt: now + 1,
	...overrides,
});

const createContainerService = () => ({
	initialize: vi.fn(async () => undefined),
	dispose: vi.fn(async () => undefined),
	isReady: vi.fn(() => true),
	health: vi.fn(async () => ({ ready: true, initializedAt: now })),
	resetRuntime: vi.fn(async () => undefined),
	executeCode: vi.fn(async () => ({
		status: "ok" as const,
		durationMs: 2,
		result: "2",
		logs: [],
		truncatedLogs: 0,
	})),
	runFile: vi.fn(async () => ({
		status: "ok" as const,
		durationMs: 3,
		result: "file",
		logs: [],
		truncatedLogs: 0,
		path: "/projects/app/main.js",
	})),
	executeCommand: vi.fn(async () => command({ status: "running", completed: false })),
	createRepl: vi.fn(async () => ({ replId: "repl-1" })),
	replEval: vi.fn(async () => ({
		status: "ok" as const,
		durationMs: 1,
		result: "3",
		logs: [],
		truncatedLogs: 0,
	})),
	listCommands: vi.fn(async () => ({
		commands: [
			{
				commandId: "command-1",
				command: "echo ok",
				cwd: "/projects/app",
				status: "running" as const,
				outputTail: "ok",
				nextOffset: 2,
				updatedAt: now,
			},
		],
	})),
	listenCommand: vi.fn(async ({ offset }: { offset: number }) =>
		offset === 0
			? command({ stdout: "abc", nextOffset: 3, status: "running", completed: false })
			: command({ stdout: "def", nextOffset: 6 }),
	),
	sendCommandInput: vi.fn(async () => ({ commandId: "command-1" })),
	stopCommand: vi.fn(async () => ({ commandId: "command-1" })),
	mkdir: vi.fn(async ({ path }: { path: string }) => ({ path })),
	unlink: vi.fn(async ({ path }: { path: string }) => ({ path })),
	installPackage: vi.fn(async () => ({ success: true, installed: { zod: "4.1.5" } })),
	installFromPackageJson: vi.fn(async () => ({ success: true, installed: { zod: "4.1.5" } })),
	listInstalledPackages: vi.fn(async () => ({ packages: { zod: "4.1.5" } })),
	startServer: vi.fn(async () => ({
		port: 5173,
		kind: "vite" as const,
		url: "sandbox://vite/",
		renderUrl: "sandbox://vite/render",
		rootDir: "/projects/app",
		createdFiles: [],
	})),
	stopServer: vi.fn(async () => undefined),
	listServers: vi.fn(async () => ({
		servers: [
			{
				port: 5173,
				kind: "vite" as const,
				url: "sandbox://vite/",
				renderUrl: "sandbox://vite/render",
				rootDir: "/projects/app",
			},
		],
	})),
	requestServer: vi.fn(async () => ({
		url: "sandbox://vite/",
		status: 200,
		ok: true,
		contentType: "text/html",
		responseType: "html" as const,
		headers: {},
		body: "<main>preview</main>",
	})),
	fetchResource: vi.fn(async () => ({
		url: "https://example.test/data",
		status: 200,
		ok: true,
		contentType: "text/plain",
		responseType: "text" as const,
		body: "abcdef",
	})),
	getSnapshot: vi.fn(async () => ({ snapshot: { files: ["main.js"] } })),
	restoreSnapshot: vi.fn(async () => undefined),
	getLogs: vi.fn(async () => ({ logs: [] })),
	clearLogs: vi.fn(async () => ({ cleared: true })),
	request: vi.fn(async (operation: string) =>
		operation === "fs.flushWorkspaceWrites"
			? {
					ops: [
						{ op: "write", path: "/projects/app/out.txt", content: "generated" },
						{
							op: "rename",
							oldPath: "/projects/app/a.txt",
							newPath: "/projects/app/b.txt",
						},
					],
				}
			: { success: true },
	),
});

const context = {
	operationId: "browser-provider-test",
	sessionKey: "conversation-1",
};

describe("BrowserSandboxProvider", () => {
	it("passes the reusable provider conformance suite", async () => {
		const service = createContainerService();
		await expectSandboxProviderConformance(
			new BrowserSandboxProvider(service as never),
		);
	});

	it("validates browser-specific provider options", async () => {
		const service = createContainerService();
		await expect(
			new BrowserSandboxProvider(service as never).createSession(
				{ sessionKey: "conversation-1", providerOptions: { region: "remote" } },
				context,
			),
		).rejects.toMatchObject({ code: "invalid_request" });
		expect(service.initialize).not.toHaveBeenCalled();
	});

	it("maps every provider domain without leaking numeric process offsets", async () => {
		const service = createContainerService();
		const session = await new BrowserSandboxProvider(
			service as never,
		).createSession({ sessionKey: "conversation-1" }, context);

		await session.workspace.bind(
			{
				root: "/projects/app",
				directories: ["/projects/app"],
				files: [{ path: "/projects/app/main.js", content: "1 + 1" }],
			},
			context,
		);
		expect(service.request).toHaveBeenCalledWith("fs.mountWorkspace", {
			directories: ["/projects/app"],
			files: ["/projects/app/main.js"],
		});
		expect(service.request).toHaveBeenCalledWith(
			"fs.materializeWorkspaceFile",
			{ path: "/projects/app/main.js", content: "1 + 1" },
		);

		await expect(
			session.runtime.run({ operation: "code", code: "1 + 1" }, context),
		).resolves.toMatchObject({ kind: "code", result: "2" });
		await expect(
			session.runtime.run(
				{ operation: "file", path: "/projects/app/main.js" },
				context,
			),
		).resolves.toMatchObject({ kind: "file", path: "/projects/app/main.js" });
		await expect(
			session.runtime.run({ operation: "repl", code: "1 + 2" }, context),
		).resolves.toMatchObject({ kind: "repl", replId: "repl-1" });

		const first = await session.processes.manage(
			{ operation: "read", processId: "command-1", cursor: "0" },
			context,
		);
		const second = await session.processes.manage(
			{ operation: "read", processId: "command-1", cursor: "3" },
			context,
		);
		expect(first).toMatchObject({ nextCursor: "3" });
		expect(second).toMatchObject({ nextCursor: "6" });
		expect("events" in first && first.events[0]?.text).toBe("abc");
		expect("events" in second && second.events[0]?.text).toBe("def");
		expect(service.listenCommand.mock.calls.map(([request]) => request.offset)).toEqual([
			0,
			3,
		]);
		await expect(
			session.processes.manage(
				{ operation: "read", processId: "command-1", cursor: "invalid" },
				context,
			),
		).rejects.toMatchObject({ code: "invalid_request" });

		await expect(
			session.packages?.manage({ operation: "list" }, context),
		).resolves.toEqual({ success: true, packages: { zod: "4.1.5" } });
		const preview = await session.previews?.manage(
			{ operation: "start", projectDir: "/projects/app", kind: "vite" },
			context,
		);
		expect(preview).toMatchObject({ previewId: expect.any(String), port: 5173 });
		await expect(
			session.network?.fetch(
				{ url: "https://example.test/data", maxChars: 3 },
				context,
			),
		).resolves.toMatchObject({ body: "abc", truncated: true });

		const snapshot = await session.snapshots?.manage(
			{ operation: "create", label: "baseline" },
			context,
		);
		expect(snapshot?.snapshotId).toEqual(expect.any(String));
		await expect(
			session.snapshots?.manage(
				{ operation: "restore", snapshotId: snapshot?.snapshotId ?? "" },
				context,
			),
		).resolves.toMatchObject({ restored: true });

		await expect(session.workspace.flush(context)).resolves.toEqual({
			changedPaths: [
				"/projects/app/out.txt",
				"/projects/app/a.txt",
				"/projects/app/b.txt",
			],
			conflicts: [],
			changes: [
				{
					operation: "write",
					path: "/projects/app/out.txt",
					content: "generated",
				},
				{
					operation: "rename",
					oldPath: "/projects/app/a.txt",
					newPath: "/projects/app/b.txt",
				},
			],
		});
	});

	it("continues truncated process output without duplicates or gaps", async () => {
		const service = createContainerService();
		service.listenCommand.mockImplementation(async ({ offset }: { offset: number }) =>
			offset === 0
				? command({
						stdout: "abc",
						stderr: "def",
						chunks: [
							{ stdout: "abc", stderr: "" },
							{ stdout: "", stderr: "def" },
						],
						nextOffset: 2,
					})
				: command({
						stdout: "",
						stderr: "def",
						chunks: [{ stdout: "", stderr: "def" }],
						nextOffset: 2,
					}),
		);
		const session = await new BrowserSandboxProvider(
			service as never,
		).createSession({ sessionKey: "conversation-1" }, context);

		const first = await session.processes.manage(
			{ operation: "read", processId: "command-1", maxChars: 4 },
			context,
		);
		expect(first).toMatchObject({ nextCursor: "1:1", truncated: true });
		const second = await session.processes.manage(
			{
				operation: "read",
				processId: "command-1",
				cursor: "1:1",
				maxChars: 4,
			},
			context,
		);
		expect(second).toMatchObject({ nextCursor: "2", truncated: false });

		const text = [first, second]
			.flatMap((result) => ("events" in result ? result.events : []))
			.filter((event) => event.type !== "status")
			.map((event) => event.text)
			.join("");
		expect(text).toBe("abcdef");
		expect(service.listenCommand.mock.calls.map(([request]) => request.offset)).toEqual([
			0,
			1,
		]);
	});

	it("maps every remaining runtime, process, package, preview, and inspect operation", async () => {
		const service = createContainerService();
		const session = await new BrowserSandboxProvider(
			service as never,
		).createSession({ sessionKey: "conversation-1" }, context);

		await expect(
			session.runtime.run(
				{ operation: "command", command: "npm test", cwd: "/projects/app" },
				context,
			),
		).resolves.toMatchObject({ kind: "command", processId: "command-1" });
		await expect(
			session.processes.manage({ operation: "list" }, context),
		).resolves.toMatchObject({
			processes: [expect.objectContaining({ processId: "command-1" })],
		});
		await expect(
			session.processes.manage(
				{ operation: "stdin", processId: "command-1", input: "q" },
				context,
			),
		).resolves.toEqual({ processId: "command-1", sent: true });
		await expect(
			session.processes.manage(
				{ operation: "stop", processId: "command-1" },
				context,
			),
		).resolves.toEqual({ processId: "command-1", stopped: true });

		await expect(
			session.packages?.manage(
				{ operation: "install", packageSpec: "zod@4.1.5", save: true },
				context,
			),
		).resolves.toEqual({ success: true, packages: { zod: "4.1.5" } });
		await expect(
			session.packages?.manage(
				{ operation: "install_from_package_json" },
				context,
			),
		).resolves.toEqual({ success: true, packages: { zod: "4.1.5" } });

		const started = await session.previews!.manage(
			{ operation: "start", projectDir: "/projects/app", kind: "vite" },
			context,
		);
		const previewId = "previewId" in started ? started.previewId : "";
		expect(previewId).not.toBe("");
		await expect(
			session.previews!.manage({ operation: "list" }, context),
		).resolves.toMatchObject({ previews: [expect.objectContaining({ previewId })] });
		await expect(
			session.previews!.manage(
				{ operation: "request", previewId, path: "/api" },
				context,
			),
		).resolves.toMatchObject({ previewId, status: 200, body: "<main>preview</main>" });
		await expect(
			session.previews!.manage(
				{ operation: "render", previewId, path: "/" },
				context,
			),
		).resolves.toMatchObject({ previewId, responseType: "html" });
		expect(service.requestServer).toHaveBeenLastCalledWith(
			expect.objectContaining({ port: 5173, useIframe: true }),
		);
		await expect(
			session.previews!.manage(
				{ operation: "restart", projectDir: "/projects/app", kind: "vite", port: 5173 },
				context,
			),
		).resolves.toMatchObject({ previewId, port: 5173 });
		await expect(
			session.previews!.manage({ operation: "stop", previewId }, context),
		).resolves.toEqual({ previewId, stopped: true });
		expect(service.stopServer).toHaveBeenCalledTimes(2);

		await expect(
			session.inspect({ operation: "status" }, context),
		).resolves.toMatchObject({ status: "ready", processCount: 1, previewCount: 1 });
		await expect(
			session.inspect({ operation: "logs", limit: 10 }, context),
		).resolves.toEqual({ logs: [] });
		await expect(
			session.inspect({ operation: "clear_logs" }, context),
		).resolves.toEqual({ cleared: true });
		await expect(
			session.inspect({ operation: "reset" }, context),
		).resolves.toEqual({ reset: true });
		await session.reset(context);
		expect(service.resetRuntime).toHaveBeenCalledTimes(2);

		await session.workspace.bind(
			{
				root: "/projects/app",
				directories: ["/projects/app/new"],
				files: [{ path: "/projects/app/new/main.js", content: "42" }],
				deletedPaths: ["/projects/app/old.js"],
				mode: "incremental",
			},
			context,
		);
		expect(service.mkdir).toHaveBeenCalledWith({ path: "/projects/app/new" });
		expect(service.unlink).toHaveBeenCalledWith({ path: "/projects/app/old.js" });

		await expect(
			session.snapshots!.manage(
				{ operation: "restore", snapshotId: "missing" },
				context,
			),
		).rejects.toMatchObject({ code: "snapshot_not_found" });
	});
});
