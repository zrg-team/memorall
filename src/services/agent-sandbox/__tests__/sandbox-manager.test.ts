import { describe, expect, it, vi } from "vitest";
import type { IFlowFileSystem } from "flow-core/interfaces/services/filesystem";
import type {
	SandboxCallContext,
	SandboxCapabilities,
	SandboxProvider,
	SandboxProviderSession,
	SandboxSessionRequest,
	SandboxWorkspaceManifest,
} from "flow-core/interfaces/services/agent-sandbox";
import { SandboxError } from "flow-core/interfaces/services/agent-sandbox";
import { SandboxManager } from "../sandbox-manager";
import { SandboxProviderRegistry } from "../provider-registry";
import { SandboxWorkspaceCoordinator } from "../workspace-coordinator";
import { expectSandboxProviderConformance } from "./provider-conformance";

const capabilities: SandboxCapabilities = {
	supported: [
		"runtime.code",
		"runtime.command",
		"process.background",
		"process.stdin",
		"workspace.mount",
		"workspace.flush",
	],
	packageManagers: [],
	limits: {
		maxConcurrentSessions: 8,
		maxOutputChars: 10_000,
		maxLogEntries: 100,
	},
	extensions: { transport: "fake-remote" },
};

const createMemoryFileSystem = (initial: Record<string, string>) => {
	const files = new Map(Object.entries(initial));
	const directories = new Set<string>(["/"]);
	for (const path of files.keys()) {
		const parts = path.split("/").filter(Boolean);
		for (let index = 0; index < parts.length - 1; index += 1) {
			directories.add(`/${parts.slice(0, index + 1).join("/")}`);
		}
	}
	const fs = {
		readFile: vi.fn(async (path: string) => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`ENOENT: ${path}`);
			return new TextEncoder().encode(content);
		}),
		writeFile: vi.fn(async (path: string, content: string | Uint8Array) => {
			files.set(
				path,
				typeof content === "string" ? content : new TextDecoder().decode(content),
			);
		}),
		mkdir: vi.fn(async (path: string) => {
			directories.add(path);
			return undefined;
		}),
		rm: vi.fn(async (path: string) => {
			files.delete(path);
			directories.delete(path);
		}),
		rename: vi.fn(async (oldPath: string, newPath: string) => {
			const content = files.get(oldPath);
			if (content === undefined) throw new Error(`ENOENT: ${oldPath}`);
			files.delete(oldPath);
			files.set(newPath, content);
		}),
		readdir: vi.fn(async (path: string, options?: { withFileTypes: true }) => {
			const prefix = path === "/" ? "/" : `${path}/`;
			const names = new Map<string, "file" | "directory">();
			for (const directory of directories) {
				if (!directory.startsWith(prefix) || directory === path) continue;
				const rest = directory.slice(prefix.length);
				if (rest && !rest.includes("/")) names.set(rest, "directory");
			}
			for (const file of files.keys()) {
				if (!file.startsWith(prefix)) continue;
				const rest = file.slice(prefix.length);
				if (rest && !rest.includes("/")) names.set(rest, "file");
			}
			const entries = [...names].map(([name, type]) => ({
				name,
				isFile: () => type === "file",
				isDirectory: () => type === "directory",
				isSymbolicLink: () => false,
			}));
			return options?.withFileTypes ? entries : entries.map((entry) => entry.name);
		}),
	} as unknown as IFlowFileSystem;
	return { fs, files };
};

const makeSession = (providerId: string, index: number): SandboxProviderSession => {
	const now = Date.now();
	const descriptor = {
		sessionId: `session-${index}`,
		providerId,
		providerSessionId: `remote-${index}`,
		status: "ready" as const,
		createdAt: now,
		updatedAt: now,
	};
	return {
		descriptor,
		capabilities,
		runtime: {
			run: vi.fn(async (request) =>
				request.operation === "command"
					? {
							kind: "command" as const,
							processId: "process-1",
							command: request.command,
							cwd: request.cwd ?? "/",
							status: "completed" as const,
							completed: true,
							events: [],
							nextCursor: "cursor-1",
							exitCode: 0,
							startedAt: now,
							updatedAt: now,
						}
					: {
							kind: "code" as const,
							status: "ok" as const,
							durationMs: 1,
							result: "2",
							logs: [],
							truncatedLogs: 0,
						},
			),
		},
		processes: {
			manage: vi.fn(async (request) =>
				request.operation === "list"
					? { processes: [] }
					: request.operation === "read"
						? {
								processId: request.processId,
								events: [],
								nextCursor: request.cursor ?? "0",
								status: "completed" as const,
								exitCode: 0,
							}
						: request.operation === "stdin"
							? { processId: request.processId, sent: true as const }
							: { processId: request.processId, stopped: true as const },
			),
		},
		workspace: {
			bind: vi.fn(async (manifest: SandboxWorkspaceManifest | undefined) => ({
				changedPaths: manifest?.files.map((file) => file.path) ?? [],
				conflicts: [],
			})),
			flush: vi.fn(async () => ({
				changedPaths: ["/generated.txt", "/generated.txt"],
				conflicts: [],
			})),
		},
		inspect: vi.fn(async () => ({ ...descriptor, capabilities })),
		reset: vi.fn(async () => undefined),
		close: vi.fn(async () => undefined),
	};
};

class FakeRemoteProvider implements SandboxProvider {
	readonly id: string;
	readonly contractVersion = 1 as const;
	readonly createSession = vi.fn(
		async (_request: SandboxSessionRequest, _context: SandboxCallContext) =>
			makeSession(this.id, this.createSession.mock.calls.length),
	);
	readonly reconnectSession = vi.fn(
		async (_providerSessionId: string, _context: SandboxCallContext) =>
			makeSession(this.id, 99),
	);

	constructor(id = "remote.fake") {
		this.id = id;
	}
}

describe("SandboxProviderRegistry", () => {
	it("passes the reusable provider contract with a browser-independent fake", async () => {
		await expectSandboxProviderConformance(new FakeRemoteProvider());
	});

	it("supports arbitrary provider IDs without changing core types", () => {
		const provider = new FakeRemoteProvider("daytona.internal.v2");
		const registry = new SandboxProviderRegistry().register(provider);

		expect(registry.require("daytona.internal.v2")).toBe(provider);
		expect(registry.list().map((item) => item.id)).toEqual([
			"daytona.internal.v2",
		]);
		expect(() => registry.require("missing")).toThrowError(SandboxError);
		expect(() => registry.register(provider)).toThrow(
			"Sandbox provider already registered",
		);
	});
});

describe("SandboxManager", () => {
	it("creates once and reuses a conversation-scoped remote session", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);

		const first = await manager.acquire({ sessionKey: "conversation-1" });
		const second = await manager.acquire({ sessionKey: "conversation-1" });

		expect(second.session.sessionId).toBe(first.session.sessionId);
		expect(provider.createSession).toHaveBeenCalledTimes(1);
	});

	it("serializes concurrent acquires for the same conversation", async () => {
		const provider = new FakeRemoteProvider();
		let continueCreation!: () => void;
		const gate = new Promise<void>((resolve) => {
			continueCreation = resolve;
		});
		provider.createSession.mockImplementationOnce(async () => {
			await gate;
			return makeSession(provider.id, 1);
		});
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);

		const first = manager.acquire({ sessionKey: "conversation-1" });
		const second = manager.acquire({ sessionKey: "conversation-1" });
		await Promise.resolve();
		await Promise.resolve();
		expect(provider.createSession).toHaveBeenCalledTimes(1);
		continueCreation();
		const [firstLease, secondLease] = await Promise.all([first, second]);

		expect(secondLease.session.sessionId).toBe(firstLease.session.sessionId);
		expect(provider.createSession).toHaveBeenCalledTimes(1);
	});

	it("switches providers through configuration only and closes the prior lease", async () => {
		const firstProvider = new FakeRemoteProvider("remote.a");
		const secondProvider = new FakeRemoteProvider("remote.b");
		const registry = new SandboxProviderRegistry()
			.register(firstProvider)
			.register(secondProvider);
		const manager = new SandboxManager(registry, { providerId: firstProvider.id });
		await manager.acquire({ sessionKey: "conversation" });
		const firstSession = await firstProvider.createSession.mock.results[0].value;

		const result = await manager.acquire({
			sessionKey: "conversation",
			providerId: secondProvider.id,
		});

		expect(result.session.providerId).toBe("remote.b");
		expect(firstSession.close).toHaveBeenCalledOnce();
	});

	it("binds, flushes, and deduplicates workspace changes through the coordinator", async () => {
		const provider = new FakeRemoteProvider();
		const coordinator = new SandboxWorkspaceCoordinator();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
			coordinator,
		);
		const manifest = {
			workspaceId: "workspace-1",
			root: "/projects/app",
			directories: ["/projects/app"],
			files: [
				{ path: "/projects/app/main.js", content: "1", revision: "r1" },
			],
		};
		const lease = await manager.acquire({ sessionKey: "c1", workspace: manifest });

		expect(coordinator.getBinding(lease.session.sessionId)?.revisions.get(
			"/projects/app/main.js",
		)).toBe("r1");
		await manager.run(
			{ operation: "code", code: "1 + 1" },
			{ sessionKey: "c1" },
		);
		const session = await provider.createSession.mock.results[0].value;
		expect(session.workspace.flush).toHaveBeenCalledOnce();
	});

	it("flushes workspace changes when runtime execution fails", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);
		await manager.acquire({ sessionKey: "conversation-1" });
		const session = await provider.createSession.mock.results[0].value;
		vi.mocked(session.runtime.run).mockRejectedValueOnce(new Error("execution failed"));

		await expect(
			manager.run(
				{ operation: "code", code: "throw new Error('failed')" },
				{ sessionKey: "conversation-1" },
			),
		).rejects.toThrow("execution failed");
		expect(session.workspace.flush).toHaveBeenCalledOnce();
	});

	it("normalizes unsupported operations and pre-cancelled calls", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);
		await expect(
			manager.packages({ operation: "list" }),
		).rejects.toMatchObject({ code: "capability_unavailable" });

		const controller = new AbortController();
		controller.abort();
		await expect(
			manager.acquire({}, { signal: controller.signal }),
		).rejects.toMatchObject({ code: "timeout", retryable: true });
		await expect(
			manager.acquire({}, { deadlineMs: Date.now() - 1 }),
		).rejects.toMatchObject({ code: "timeout", retryable: true });
	});

	it("flushes and closes sessions under close-on-release policy", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id, sessionPolicy: "close-on-release" },
		);
		const lease = await manager.acquire({ sessionKey: "short-lived" });
		const session = await provider.createSession.mock.results[0].value;

		await manager.release("short-lived");

		expect(session.workspace.flush).toHaveBeenCalledOnce();
		expect(session.close).toHaveBeenCalledOnce();
		expect(await manager.acquire({ sessionKey: "short-lived" })).not.toEqual(
			lease,
		);
	});

	it("deduplicates provider conflict reports by path", async () => {
		const session = makeSession("remote.fake", 1);
		vi.mocked(session.workspace.flush).mockResolvedValueOnce({
			changedPaths: ["/a", "/a"],
			conflicts: [
				{ path: "/a", expectedRevision: "r1", actualRevision: "r2" },
				{ path: "/a", expectedRevision: "r1", actualRevision: "r3" },
			],
		});
		const result = await new SandboxWorkspaceCoordinator().flush(session, {
			operationId: "flush-conflict",
		});

		expect(result.changedPaths).toEqual(["/a"]);
		expect(result.conflicts).toEqual([
			{ path: "/a", expectedRevision: "r1", actualRevision: "r3" },
		]);
	});

	it("reconnects using an opaque provider session ID", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);
		const result = await manager.acquire({
			sessionKey: "resumed",
			resumeProviderSessionId: "opaque-token",
		});

		expect(result.session.providerSessionId).toBe("remote-99");
		expect(provider.reconnectSession).toHaveBeenCalledWith(
			"opaque-token",
			expect.objectContaining({ sessionKey: "resumed" }),
		);
	});

	it("reconnects suspended sessions and replaces stopped sessions", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);
		await manager.acquire({ sessionKey: "conversation" });
		const first = await provider.createSession.mock.results[0].value;
		(first.descriptor as { status: string }).status = "suspended";

		const resumed = await manager.acquire({ sessionKey: "conversation" });
		expect(resumed.session.providerSessionId).toBe("remote-99");
		expect(provider.reconnectSession).toHaveBeenCalledWith(
			first.descriptor.providerSessionId,
			expect.any(Object),
		);

		const resumedSession = await provider.reconnectSession.mock.results[0].value;
		(resumedSession.descriptor as { status: string }).status = "stopped";
		const replaced = await manager.acquire({ sessionKey: "conversation" });
		expect(replaced.session.sessionId).not.toBe(resumed.session.sessionId);
		expect(resumedSession.close).toHaveBeenCalledOnce();
	});

	it("does not close a healthy session when an unknown provider is requested", async () => {
		const provider = new FakeRemoteProvider();
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
		);
		await manager.acquire({ sessionKey: "conversation" });
		const session = await provider.createSession.mock.results[0].value;

		await expect(
			manager.acquire({ sessionKey: "conversation", providerId: "missing" }),
		).rejects.toMatchObject({ code: "provider_error" });
		expect(session.close).not.toHaveBeenCalled();
	});

	it("pushes incremental host changes and applies remote flush deltas", async () => {
		const provider = new FakeRemoteProvider();
		const memory = createMemoryFileSystem({
			"/project/main.js": "one",
			"/project/added.txt": "before",
		});
		const coordinator = new SandboxWorkspaceCoordinator(memory.fs, "/project");
		const manager = new SandboxManager(
			new SandboxProviderRegistry().register(provider),
			{ providerId: provider.id },
			coordinator,
		);
		await manager.acquire({ sessionKey: "workspace" });
		const session = await provider.createSession.mock.results[0].value;

		memory.files.set("/project/main.js", "two");
		memory.files.set("/project/new.txt", "new");
		await manager.run(
			{ operation: "code", code: "1 + 1" },
			{ sessionKey: "workspace" },
		);

		expect(session.workspace.bind).toHaveBeenLastCalledWith(
			expect.objectContaining({
				mode: "incremental",
				files: expect.arrayContaining([
					expect.objectContaining({ path: "/project/main.js", content: "two" }),
					expect.objectContaining({ path: "/project/new.txt", content: "new" }),
				]),
			}),
			expect.any(Object),
		);

		vi.mocked(session.workspace.flush).mockResolvedValueOnce({
			changedPaths: [],
			conflicts: [],
			changes: [
				{ operation: "write", path: "/project/generated.txt", content: "generated" },
				{ operation: "rename", oldPath: "/project/added.txt", newPath: "/project/renamed.txt" },
				{ operation: "delete", path: "/project/main.js" },
			],
		});
		await manager.release("workspace");

		expect(memory.files.get("/project/generated.txt")).toBe("generated");
		expect(memory.files.get("/project/renamed.txt")).toBe("before");
		expect(memory.files.has("/project/added.txt")).toBe(false);
		expect(memory.files.has("/project/main.js")).toBe(false);
	});

	it("reports a host revision conflict without overwriting the host file", async () => {
		const memory = createMemoryFileSystem({ "/project/main.js": "baseline" });
		const coordinator = new SandboxWorkspaceCoordinator(memory.fs, "/project");
		const session = makeSession("remote.fake", 1);
		await coordinator.bind(session, undefined, { operationId: "bind" });
		memory.files.set("/project/main.js", "host edit");
		vi.mocked(session.workspace.flush).mockResolvedValueOnce({
			changedPaths: ["/project/main.js"],
			conflicts: [],
			changes: [
				{ operation: "write", path: "/project/main.js", content: "provider edit" },
			],
		});

		const result = await coordinator.flush(session, { operationId: "flush" });

		expect(result.conflicts).toEqual([
			expect.objectContaining({ path: "/project/main.js" }),
		]);
		expect(memory.files.get("/project/main.js")).toBe("host edit");
	});
});
