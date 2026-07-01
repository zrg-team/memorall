import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseJob, ProcessDependencies } from "../types";

const {
	llmService,
	sandboxService,
	webBrowserService,
	serviceManager,
	authMocks,
	systemMocks,
} = vi.hoisted(() => {
	const llmService = {
		getCurrentModel: vi.fn(async () => ({
			modelId: "model",
			provider: "openai",
		})),
		models: vi.fn(async () => ({ object: "list", data: [{ id: "m1" }] })),
		modelsFor: vi.fn(async () => ({
			object: "list",
			data: [{ id: "model", loaded: true }],
		})),
		getMaxModelTokens: vi.fn(async () => 4096),
		getMaxModelTokensFor: vi.fn(async () => 8192),
		getMaxResponseTokens: vi.fn(async () => 1024),
		getMaxResponseTokensFor: vi.fn(async () => 2048),
		serveFor: vi.fn(async () => ({ id: "model", loaded: true })),
		unloadFor: vi.fn(async () => undefined),
		deleteModelFor: vi.fn(async () => undefined),
		create: vi.fn(async () => undefined),
		has: vi.fn((name: string) => name === "openai"),
		getInfoFor: vi.fn((name: string) => ({
			name,
			type: "openai",
			ready: true,
		})),
		chatCompletionsFor: vi.fn(async () => ({ choices: [] })),
		remove: vi.fn(),
		list: vi.fn(() => ["openai"]),
	};
	const sandboxService = {
		health: vi.fn(async () => ({ ok: true })),
		executeCode: vi.fn(async (payload) => ({ op: "executeCode", payload })),
		runFile: vi.fn(async (payload) => ({ op: "runFile", payload })),
		executeCommand: vi.fn(async (payload) => ({
			op: "executeCommand",
			payload,
		})),
		listenCommand: vi.fn(async (payload) => ({ op: "listenCommand", payload })),
		sendCommandInput: vi.fn(async (payload) => ({
			op: "sendCommandInput",
			payload,
		})),
		stopCommand: vi.fn(async (payload) => ({ op: "stopCommand", payload })),
		listCommands: vi.fn(async () => ({ op: "listCommands" })),
		createRepl: vi.fn(async () => ({ op: "createRepl" })),
		replEval: vi.fn(async (payload) => ({ op: "replEval", payload })),
		getLogs: vi.fn(async (payload) => ({ op: "getLogs", payload })),
		clearLogs: vi.fn(async () => ({ op: "clearLogs" })),
		fetchResource: vi.fn(async (payload) => ({ op: "fetchResource", payload })),
		writeFile: vi.fn(async (payload) => ({ op: "writeFile", payload })),
		readFile: vi.fn(async (payload) => ({ op: "readFile", payload })),
		mkdir: vi.fn(async (payload) => ({ op: "mkdir", payload })),
		readdir: vi.fn(async (payload) => ({ op: "readdir", payload })),
		unlink: vi.fn(async (payload) => ({ op: "unlink", payload })),
		rename: vi.fn(async (payload) => ({ op: "rename", payload })),
		exists: vi.fn(async (payload) => ({ op: "exists", payload })),
		installPackage: vi.fn(async (payload) => ({
			op: "installPackage",
			payload,
		})),
		installFromPackageJson: vi.fn(async (payload) => ({
			op: "installFromPackageJson",
			payload,
		})),
		listInstalledPackages: vi.fn(async () => ({ op: "listInstalledPackages" })),
		startServer: vi.fn(async (payload) => ({ op: "startServer", payload })),
		stopServer: vi.fn(async (payload) => ({ op: "stopServer", payload })),
		listServers: vi.fn(async () => ({ op: "listServers" })),
		requestServer: vi.fn(async (payload) => ({ op: "requestServer", payload })),
		getServerRenderUrl: vi.fn(async (payload) => ({
			op: "getServerRenderUrl",
			payload,
		})),
		getSnapshot: vi.fn(async () => ({ op: "getSnapshot" })),
		restoreSnapshot: vi.fn(async (payload) => ({
			op: "restoreSnapshot",
			payload,
		})),
		request: vi.fn(async (operation, payload) => ({ operation, payload })),
	};
	const webBrowserService = {
		openSession: vi.fn(async (payload) => ({ op: "openSession", payload })),
		refreshSession: vi.fn(async (payload) => ({
			op: "refreshSession",
			payload,
		})),
		getOrOpenSession: vi.fn(async (payload) => ({
			op: "getOrOpenSession",
			payload,
		})),
		closeSession: vi.fn(async () => undefined),
		disposeActiveSession: vi.fn(async () => undefined),
		getActiveSessionInfo: vi.fn(async () => ({ active: true })),
		getAllSessionsInfo: vi.fn(async () => [{ id: "s1" }]),
		trimToLatestSession: vi.fn(async () => undefined),
		fetchRenderedFallback: vi.fn(async (payload) => ({
			op: "fetchRenderedFallback",
			payload,
		})),
		queryDomElements: vi.fn(async (payload) => ({
			op: "queryDomElements",
			payload,
		})),
		performDomAction: vi.fn(async (payload) => ({
			op: "performDomAction",
			payload,
		})),
		searchInSessionHtml: vi.fn(async (payload) => ({
			op: "searchInSessionHtml",
			payload,
		})),
		waitForDomSelector: vi.fn(async (payload) => ({
			op: "waitForDomSelector",
			payload,
		})),
		waitForPageRender: vi.fn(async (payload) => ({
			op: "waitForPageRender",
			payload,
		})),
	};
	return {
		llmService,
		sandboxService,
		webBrowserService,
		serviceManager: {
			getLLMService: vi.fn(() => llmService),
			getSandboxContainerService: vi.fn(() => sandboxService),
			getWebBrowserService: vi.fn(() => webBrowserService),
		},
		authMocks: {
			restoreAuthProvider: vi.fn(async () => undefined),
			restoreAllProviders: vi.fn(async () => undefined),
			getEncryptedProviders: vi.fn(async () => ["openai"]),
			checkProviderNeedsRestore: vi.fn(async () => true),
			unlockAndRestoreProvidersWithPasskey: vi.fn(async () => ({
				masterStrongPassword: "strong",
				providers: ["openai", "openrouter"],
			})),
		},
		systemMocks: {
			detectSystemSpecs: vi.fn(async () => ({
				memoryGB: 16,
				cpuCores: 8,
				hasWebGPU: true,
				deviceCategory: "high",
			})),
		},
	};
});

vi.mock("@/services", () => ({ serviceManager }));
vi.mock("@/utils/auth-provider-restore", () => ({
	restoreAuthProvider: authMocks.restoreAuthProvider,
	restoreAllProviders: authMocks.restoreAllProviders,
	getEncryptedProviders: authMocks.getEncryptedProviders,
	checkProviderNeedsRestore: authMocks.checkProviderNeedsRestore,
}));
vi.mock("@/utils/provider-passkey-unlock", () => ({
	unlockAndRestoreProvidersWithPasskey:
		authMocks.unlockAndRestoreProvidersWithPasskey,
}));
vi.mock("@/main/modules/llm/utils/system-detection", () => systemMocks);

import { LLMOperationsHandler } from "../process-llm-operations";
import { SandboxOperationsHandler } from "../process-sandbox-operations";
import { WebBrowserOperationsHandler } from "../process-web-browser-operations";

const deps = (): ProcessDependencies => ({
	logger: {
		info: vi.fn(async () => undefined),
		error: vi.fn(async () => undefined),
		warn: vi.fn(async () => undefined),
		debug: vi.fn(async () => undefined),
	},
	updateJobProgress: vi.fn(async () => undefined),
	completeJob: vi.fn(async () => undefined),
});

const job = (jobType: string, payload: unknown = {}): BaseJob =>
	({
		id: `${jobType}-id`,
		jobType,
		status: "pending",
		createdAt: new Date("2024-01-01T00:00:00.000Z"),
		progress: [],
		payload,
	}) as BaseJob;

async function* chunks() {
	yield { choices: [{ delta: { content: "a" } }] };
	yield { choices: [{ delta: { content: "b" } }] };
}

beforeEach(() => {
	vi.clearAllMocks();
	serviceManager.getLLMService.mockReturnValue(llmService);
});

describe("LLMOperationsHandler", () => {
	it("handles model metadata and token jobs", async () => {
		const handler = new LLMOperationsHandler();

		await expect(
			handler.process("j1", job("get-current-model"), deps()),
		).resolves.toEqual({ modelInfo: { modelId: "model", provider: "openai" } });
		await expect(
			handler.process("j2", job("get-all-models"), deps()),
		).resolves.toEqual({ models: { object: "list", data: [{ id: "m1" }] } });
		await expect(
			handler.process(
				"j3",
				job("get-models-for-service", { serviceName: "openai" }),
				deps(),
			),
		).resolves.toEqual({
			models: { object: "list", data: [{ id: "model", loaded: true }] },
		});
		await expect(
			handler.process(
				"j4",
				job("get-max-model-tokens", { model: "m" }),
				deps(),
			),
		).resolves.toEqual({ maxModelTokens: 4096 });
		await expect(
			handler.process(
				"j5",
				job("get-max-model-tokens", { serviceName: "openai", model: "m" }),
				deps(),
			),
		).resolves.toEqual({ maxModelTokens: 8192 });
		await expect(
			handler.process(
				"j6",
				job("get-max-response-tokens", { model: "m" }),
				deps(),
			),
		).resolves.toEqual({ maxResponseTokens: 1024 });
		await expect(
			handler.process(
				"j7",
				job("get-max-response-tokens", { serviceName: "openai", model: "m" }),
				deps(),
			),
		).resolves.toEqual({ maxResponseTokens: 2048 });
	});

	it("serves, unloads, deletes, and creates services", async () => {
		const handler = new LLMOperationsHandler();

		await expect(
			handler.process(
				"j8",
				job("serve-model", {
					modelId: "model",
					provider: "openai",
					serviceName: "openai",
				}),
				deps(),
			),
		).resolves.toEqual({ modelInfo: { id: "model", loaded: true } });

		llmService.modelsFor.mockResolvedValueOnce({ object: "list", data: [] });
		await handler.process(
			"j9",
			job("serve-model", {
				modelId: "new-model",
				provider: "openai",
				serviceName: "openai",
			}),
			deps(),
		);
		expect(llmService.serveFor).toHaveBeenCalledWith(
			"openai",
			"new-model",
			expect.any(Function),
		);

		await expect(
			handler.process(
				"j10",
				job("unload-model", { serviceName: "openai", modelId: "m" }),
				deps(),
			),
		).resolves.toEqual({ unloaded: true, modelId: "m", serviceName: "openai" });
		await expect(
			handler.process(
				"j11",
				job("delete-model", { serviceName: "openai", modelId: "m" }),
				deps(),
			),
		).resolves.toEqual({ deleted: true, modelId: "m", serviceName: "openai" });
		await expect(
			handler.process(
				"j12",
				job("create-llm-service", {
					name: "openai",
					llmType: "openai",
					config: { type: "openai" },
				}),
				deps(),
			),
		).resolves.toEqual({
			serviceInfo: { name: "openai", type: "openai", ready: true },
		});

		llmService.has.mockReturnValueOnce(false);
		await handler.process(
			"j13",
			job("create-llm-service", {
				name: "new",
				llmType: "openai",
				config: { type: "openai" },
			}),
			deps(),
		);
		expect(llmService.create).toHaveBeenCalledWith("new", { type: "openai" });
	});

	it("handles chat completion, streaming, auth, system, and restore jobs", async () => {
		const handler = new LLMOperationsHandler();
		const dependencies = deps();

		await expect(
			handler.process(
				"j14",
				job("chat-completion", {
					serviceName: "openai",
					request: { messages: [], stream: false },
				}),
				dependencies,
			),
		).resolves.toEqual({ response: { choices: [] } });

		llmService.chatCompletionsFor.mockReturnValueOnce(chunks() as any);
		await expect(
			handler.process(
				"j15",
				job("chat-completion", {
					serviceName: "openai",
					request: { messages: [], stream: true },
				}),
				dependencies,
			),
		).resolves.toEqual({
			response: {
				chunks: [
					{ choices: [{ delta: { content: "a" } }] },
					{ choices: [{ delta: { content: "b" } }] },
				],
			},
		});
		expect(dependencies.updateJobProgress).toHaveBeenCalledWith(
			"j15",
			expect.objectContaining({
				stage: "Streaming token 1...",
				metadata: { chunk: { choices: [{ delta: { content: "a" } }] } },
			}),
		);

		await expect(
			handler.process(
				"j16",
				job("restore-auth-provider", { provider: "openai", passkey: "p" }),
				deps(),
			),
		).resolves.toEqual({ restored: true, provider: "openai" });
		await expect(
			handler.process(
				"j17",
				job("restore-all-providers", { masterStrongPassword: "s" }),
				deps(),
			),
		).resolves.toEqual({ restored: true, providers: ["openai"] });
		await expect(
			handler.process(
				"j18",
				job("unlock-and-restore-all-providers", { passkey: "p" }),
				deps(),
			),
		).resolves.toEqual({
			restored: true,
			providers: ["openai", "openrouter"],
		});
		await expect(
			handler.process(
				"j19",
				job("remove-auth-provider", { provider: "openai" }),
				deps(),
			),
		).resolves.toEqual({ removed: true, provider: "openai" });
		expect(llmService.remove).toHaveBeenCalledWith("openai");
		await expect(
			handler.process("j20", job("detect-system-specs"), deps()),
		).resolves.toEqual({
			specs: {
				memoryGB: 16,
				cpuCores: 8,
				hasWebGPU: true,
				deviceCategory: "high",
			},
		});
		await expect(
			handler.process(
				"j21",
				job("check-provider-needs-restore", { provider: "openai" }),
				deps(),
			),
		).resolves.toEqual({ needsRestore: true, provider: "openai" });
	});

	it("rejects missing services and unknown LLM jobs", async () => {
		const handler = new LLMOperationsHandler();
		serviceManager.getLLMService.mockReturnValueOnce(null as any);

		await expect(
			handler.process("j22", job("get-current-model"), deps()),
		).rejects.toThrow("LLM service not available");
		await expect(
			handler.process("j23", job("llm-missing"), deps()),
		).rejects.toThrow("Unknown LLM job type: llm-missing");
	});
});

describe("SandboxOperationsHandler", () => {
	const cases: Array<[string, keyof typeof sandboxService, unknown]> = [
		["health", "health", undefined],
		["runtime.executeCode", "executeCode", { code: "1" }],
		["runtime.runFile", "runFile", { path: "/a.ts" }],
		["runtime.executeCommand", "executeCommand", { command: "ls" }],
		["runtime.listenCommand", "listenCommand", { commandId: "c" }],
		["runtime.sendCommandInput", "sendCommandInput", { commandId: "c" }],
		["runtime.stopCommand", "stopCommand", { commandId: "c" }],
		["runtime.listCommands", "listCommands", undefined],
		["runtime.createRepl", "createRepl", undefined],
		["runtime.replEval", "replEval", { code: "1" }],
		["runtime.getLogs", "getLogs", {}],
		["runtime.clearLogs", "clearLogs", undefined],
		["network.fetch", "fetchResource", { url: "https://example.test" }],
		["fs.writeFile", "writeFile", { path: "/a", content: "x" }],
		["fs.readFile", "readFile", { path: "/a" }],
		["fs.mkdir", "mkdir", { path: "/d" }],
		["fs.readdir", "readdir", { path: "/" }],
		["fs.unlink", "unlink", { path: "/a" }],
		["fs.rename", "rename", { from: "/a", to: "/b" }],
		["fs.exists", "exists", { path: "/a" }],
		["npm.install", "installPackage", { packageName: "x" }],
		["npm.installFromPackageJson", "installFromPackageJson", {}],
		["npm.list", "listInstalledPackages", undefined],
		["server.start", "startServer", {}],
		["server.stop", "stopServer", {}],
		["server.list", "listServers", undefined],
		["server.request", "requestServer", {}],
		["server.renderUrl", "getServerRenderUrl", {}],
		["snapshot.get", "getSnapshot", undefined],
		["snapshot.restore", "restoreSnapshot", {}],
	];

	it.each(
		cases,
	)("dispatches %s to sandbox service", async (operation, method, payload) => {
		await expect(
			new SandboxOperationsHandler().process(
				`sandbox-${operation}`,
				job("sandbox-operation", { operation, payload }),
				deps(),
			),
		).resolves.toEqual({
			operation,
			result: expect.anything(),
		});
		expect(sandboxService[method]).toHaveBeenCalled();
	});

	it("dispatches generic request-backed sandbox operations and rejects invalid payloads", async () => {
		const handler = new SandboxOperationsHandler();
		for (const operation of [
			"fs.mountDocuments",
			"fs.materializeDocumentFile",
			"fs.mountWorkspace",
			"fs.materializeWorkspaceFile",
			"fs.flushWorkspaceWrites",
			"server.handleSwRequest",
			"runtime.reset",
		]) {
			await handler.process(
				`sandbox-${operation}`,
				job("sandbox-operation", { operation, payload: { value: operation } }),
				deps(),
			);
			expect(sandboxService.request).toHaveBeenCalledWith(operation, {
				value: operation,
			});
		}

		await expect(
			handler.process("bad", job("sandbox-operation", null), deps()),
		).rejects.toThrow("Invalid sandbox-operation payload");
		await expect(
			handler.process(
				"bad",
				job("sandbox-operation", {
					operation: "missing.operation",
					payload: {},
				}),
				deps(),
			),
		).rejects.toThrow("Unsupported sandbox operation payload");
	});
});

describe("WebBrowserOperationsHandler", () => {
	const cases: Array<
		[string, keyof typeof webBrowserService, unknown, unknown]
	> = [
		["session.open", "openSession", { url: "https://example.test" }, undefined],
		["session.refresh", "refreshSession", { sessionId: "s" }, undefined],
		["session.getOrOpen", "getOrOpenSession", { url: "x" }, undefined],
		["session.close", "closeSession", { sessionId: "s" }, { closed: true }],
		[
			"session.disposeActive",
			"disposeActiveSession",
			{ reason: "x" },
			{ disposed: true },
		],
		["session.getActiveInfo", "getActiveSessionInfo", undefined, undefined],
		["session.getAllInfo", "getAllSessionsInfo", undefined, undefined],
		[
			"session.trimToLatest",
			"trimToLatestSession",
			undefined,
			{ trimmed: true },
		],
		["content.fetchRenderedFallback", "fetchRenderedFallback", {}, undefined],
		["dom.query", "queryDomElements", {}, undefined],
		["dom.action", "performDomAction", {}, undefined],
		["search.findInPage", "searchInSessionHtml", {}, undefined],
		["wait.selector", "waitForDomSelector", {}, undefined],
		["wait.render", "waitForPageRender", {}, undefined],
	];

	it.each(
		cases,
	)("dispatches %s to web browser service", async (operation, method, payload, fixedResult) => {
		const result = await new WebBrowserOperationsHandler().process(
			`web-${operation}`,
			job("web-browser-operation", { operation, payload }),
			deps(),
		);

		expect(result).toEqual({
			operation,
			result: fixedResult ?? expect.anything(),
		});
		expect(webBrowserService[method]).toHaveBeenCalled();
	});

	it("rejects invalid web-browser payloads and unsupported operations", async () => {
		const handler = new WebBrowserOperationsHandler();

		await expect(
			handler.process("bad", job("web-browser-operation", null), deps()),
		).rejects.toThrow("Invalid web-browser-operation payload");
		await expect(
			handler.process(
				"bad",
				job("web-browser-operation", { operation: "missing", payload: {} }),
				deps(),
			),
		).rejects.toThrow("Unsupported web browser operation payload");
	});
});
