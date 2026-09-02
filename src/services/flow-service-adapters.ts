import type { IDatabaseService } from "@/services/database/interfaces/database-service.interface";
import type { IEmbeddingService } from "@/services/embedding/interfaces/embedding-service.interface";
import type { DocumentFileSystem } from "@/services/filesystem/document-filesystem";
import type { DocumentTreeNode } from "@/types/document-library";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { ISandboxContainerService } from "@/services/sandbox-container";
import { createAgentSandboxService } from "@/services/agent-sandbox";
import type { IAgentSandboxService } from "@memorall/agent-harness-flows/interfaces/services/agent-sandbox";
import type {
	SandboxExecuteCommandRequest,
	SandboxExecutionRequest,
	SandboxFsExistsRequest,
	SandboxFsMkdirRequest,
	SandboxFsReadFileRequest,
	SandboxFsReaddirRequest,
	SandboxFsRenameRequest,
	SandboxFsUnlinkRequest,
	SandboxFsWriteFileRequest,
	SandboxGetLogsRequest,
	SandboxListenCommandRequest,
	SandboxNetworkFetchRequest,
	SandboxNpmInstallRequest,
	SandboxSendCommandInputRequest,
	SandboxServerRenderUrlRequest,
	SandboxServerRequest,
	SandboxStartServerRequest,
	SandboxStopCommandRequest,
	SandboxStopServerRequest,
} from "@/services/sandbox-container";
import type { SandboxHandleSwRequestPayload } from "@/services/sandbox-container/types";
import type { IWebBrowserService } from "@/services/web-browser";
import type {
	WebFetchRenderedFallbackArgs,
	WebGetOrOpenSessionArgs,
	WebOpenSessionArgs,
	WebPerformDomActionArgs,
	WebQueryDomElementsArgs,
	WebRefreshSessionArgs,
	WebSearchInSessionArgs,
	WebWaitForRenderArgs,
	WebWaitForSelectorArgs,
} from "@/services/web-browser";
import type { IFlowDatabase } from "./flows-memory/interfaces/database";
import type { IFlowEmbeddingService } from "./flows-memory/interfaces/embedding";
import type {
	DirEntry,
	FileStat,
	IFlowFileSystem,
} from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { IFlowLLMService } from "@memorall/agent-harness-flows/interfaces/services/llm";
import type {
	IFlowSandboxService,
	SandboxRequest,
} from "@memorall/agent-harness-flows/interfaces/services/sandbox";
import type { SandboxCommandResult } from "@memorall/agent-harness-flows/interfaces/services/sandbox";
import type {
	IFlowWebBrowserService,
	WebOpenSessionResult as FlowWebOpenSessionResult,
	WebRefreshSessionArgs as FlowWebRefreshSessionArgs,
	WebRenderedFallbackResult as FlowWebRenderedFallbackResult,
} from "@memorall/agent-harness-flows/interfaces/services/web-browser";
import type { IFlowLogger } from "@memorall/agent-harness-flows/logging/logger";
import { setFlowLogger } from "@memorall/agent-harness-flows/logging/logger";
import { setHtmlParser } from "@memorall/agent-harness-flows/utils/html-parser";
import { serviceRegistry } from "@memorall/agent-harness-flows/registries/service-registry";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@memorall/agent-harness-flows/interfaces/engine/messages";
import { schema as appDatabaseSchema } from "@/services/database/schema";
import type {
	IKnowledgeDatabase,
	KnowledgeDatabaseContext,
} from "./flows-memory/interfaces/knowledge";

type FlowChatCreate = NonNullable<
	IFlowLLMService["chat"]
>["completions"]["create"];

export const consoleFlowLogger: IFlowLogger = {
	info: (msg, ...args) => console.info(msg, ...args),
	error: (msg, ...args) => console.error(msg, ...args),
	warn: (msg, ...args) => console.warn(msg, ...args),
	debug: (msg, ...args) => console.debug(msg, ...args),
};

let legacyLoggerRegistered = false;

export const registerLegacyFlowLogger = (): void => {
	if (legacyLoggerRegistered) return;
	legacyLoggerRegistered = true;
	setFlowLogger(consoleFlowLogger);
	serviceRegistry.registerInstance("logger", consoleFlowLogger);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const requestObject = (
	value: SandboxRequest | string,
	key: string,
): SandboxRequest => (typeof value === "string" ? { [key]: value } : value);

const normalizeRows = <T>(value: unknown): { rows?: T[] } | T[] => {
	if (Array.isArray(value)) {
		return value as T[];
	}
	if (isRecord(value) && Array.isArray(value.rows)) {
		return { rows: value.rows as T[] };
	}
	return [];
};

const normalizeRowArray = <T>(value: unknown): T[] => {
	const normalized = normalizeRows<T>(value);
	return Array.isArray(normalized) ? normalized : (normalized.rows ?? []);
};

import {
	DOCUMENTS_SANDBOX_ROOT,
	FILESYSTEM_SANDBOX_ROOT,
	toDocumentsSandboxPath,
	normalizeSandboxPath,
	sandboxPathToFsPath,
} from "@/services/filesystem/sandbox-paths";

const DOCUMENTS_FS_ROOT = sandboxPathToFsPath(DOCUMENTS_SANDBOX_ROOT);

const normalizeFsPath = (path: string): string => {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	return normalized || "/";
};

/** Convert an internal FS path or public path to its root logical path. */
const documentFsPathToLogicalPath = (path: string): string => {
	const normalized = normalizeFsPath(path);
	if (normalized === DOCUMENTS_FS_ROOT) return "/";
	if (normalized.startsWith(`${DOCUMENTS_FS_ROOT}/`)) {
		return normalized.slice(DOCUMENTS_FS_ROOT.length);
	}
	return normalizeSandboxPath(normalized);
};

const documentFsPathToSandboxPath = (path: string): string =>
	toDocumentsSandboxPath(documentFsPathToLogicalPath(path));

const flowFsPathToSandboxPath = (path: string): string =>
	documentFsPathToSandboxPath(path);

const findTreeNode = (
	nodes: DocumentTreeNode[],
	logicalPath: string,
): DocumentTreeNode | undefined => {
	const normalized = normalizeFsPath(logicalPath);
	for (const node of nodes) {
		if (normalizeFsPath(node.path) === normalized) return node;
		const child = findTreeNode(node.children ?? [], normalized);
		if (child) return child;
	}
	return undefined;
};

const getTreeNode = async (
	service: DocumentFileSystem,
	path: string,
): Promise<DocumentTreeNode> => {
	const logicalPath = documentFsPathToLogicalPath(path);
	const tree = await service.getTree(FILESYSTEM_SANDBOX_ROOT);
	if (logicalPath === "/") {
		return {
			id: "/",
			name: "",
			path: "/",
			type: "folder",
			isExpanded: false,
			children: tree,
		};
	}
	const node = findTreeNode(tree, logicalPath);
	if (!node) {
		throw new Error(`Path not found: ${path}`);
	}
	return node;
};

const splitParentAndName = (path: string): { parent: string; name: string } => {
	const normalized = normalizeFsPath(path);
	const slash = normalized.lastIndexOf("/");
	const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
	const parent = slash > 0 ? normalized.slice(0, slash) : "/";
	if (!name) throw new Error(`Invalid path: ${path}`);
	return { parent, name };
};

const toDirEntry = (node: {
	name: string;
	type?: string;
	children?: unknown[];
}): DirEntry => ({
	name: node.name,
	isFile: () => node.type === "file",
	isDirectory: () => node.type === "folder",
	isSymbolicLink: () => false,
});

const toFileStat = (size = 0, type: "file" | "folder" = "file"): FileStat => {
	const now = new Date();
	return {
		isFile: () => type === "file",
		isDirectory: () => type === "folder",
		isSymbolicLink: () => false,
		size,
		mtime: now,
		atime: now,
		ctime: now,
		birthtime: now,
		mode: type === "folder" ? 0o755 : 0o644,
	};
};

const normalizeWebOpenResult = (
	result:
		| Awaited<ReturnType<IWebBrowserService["openSession"]>>
		| Awaited<ReturnType<IWebBrowserService["getOrOpenSession"]>>,
): FlowWebOpenSessionResult => ({
	session: result.session,
	disposable: result.disposable ?? false,
	renderReady: "renderReady" in result ? result.renderReady : true,
});

const normalizeWebRefreshResult = (
	result: Awaited<ReturnType<IWebBrowserService["refreshSession"]>>,
): FlowWebOpenSessionResult => ({
	session: result,
	disposable: false,
	renderReady: true,
});

export const toFlowLLM = (service: ILLMService): IFlowLLMService => {
	const create = ((
		body: ChatCompletionRequest,
	): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk> =>
		service.chatCompletions(body)) as FlowChatCreate;

	return {
		chat: { completions: { create } },
		models: {
			list: () => service.models(),
		},
		isReady: () => service.isReady(),
		getCurrentModel: () => service.getCurrentModel(),
		getMaxModelTokens: (model?: string) => service.getMaxModelTokens(model),
		getMaxResponseTokens: (model?: string) =>
			service.getMaxResponseTokens(model),
		chatCompletions: (body) => service.chatCompletions(body),
	};
};

/**
 * The same LLM service with `prompt_cache_key` stamped on every request that
 * does not already carry one, so all calls of one conversation share a cache
 * routing key without each step having to know about it.
 */
export const withPromptCacheKey = (
	service: IFlowLLMService,
	promptCacheKey: string,
): IFlowLLMService => {
	const stamp = (body: ChatCompletionRequest): ChatCompletionRequest =>
		body.prompt_cache_key
			? body
			: { ...body, prompt_cache_key: promptCacheKey };
	const create = ((body: ChatCompletionRequest) =>
		service.chatCompletions(stamp(body))) as FlowChatCreate;

	return {
		...service,
		chat: { completions: { create } },
		chatCompletions: (body) => service.chatCompletions(stamp(body)),
	};
};

export const toFlowEmbedding = (
	service: IEmbeddingService,
): IFlowEmbeddingService => ({
	embeddings: {
		create: async (params) => {
			const inputs = Array.isArray(params.input)
				? params.input
				: [params.input];
			const vectors =
				inputs.length === 1
					? [await service.textToVector(inputs[0])]
					: await service.textsToVectors(inputs);
			return {
				object: "list",
				model: params.model ?? "default",
				data: vectors.map((embedding, index) => ({
					object: "embedding",
					index,
					embedding,
				})),
				usage: { prompt_tokens: 0, total_tokens: 0 },
			};
		},
	},
	isReady: () => service.isReady(),
	textToVector: (text) => service.textToVector(text),
	textsToVectors: (texts) => service.textsToVectors(texts),
	get: async (name) => service.get(name),
});

export const toFlowDatabase = (service: IDatabaseService): IFlowDatabase => {
	const wrapKnowledgeContext = (
		ctx: Parameters<Parameters<IDatabaseService["use"]>[0]>[0],
	): KnowledgeDatabaseContext => ({
		db: ctx.db as unknown as KnowledgeDatabaseContext["db"],
		schema: appDatabaseSchema as unknown as KnowledgeDatabaseContext["schema"],
		raw: async (query, params) => normalizeRows(await ctx.raw(query, params)),
	});

	const knowledge: IKnowledgeDatabase = {
		schema: appDatabaseSchema as unknown as IKnowledgeDatabase["schema"],
		query: (fn, options) =>
			service.use((ctx) => fn(wrapKnowledgeContext(ctx)), options),
		transaction: (fn) =>
			service.transaction((ctx) => fn(wrapKnowledgeContext(ctx))),
		raw: async (query, params) =>
			normalizeRowArray(await service.use(({ raw }) => raw(query, params))),
	};

	const adapter: IFlowDatabase = {
		knowledge,
		collection: () => {
			throw new Error(
				"Flow database collection API is not implemented by this adapter.",
			);
		},
		transaction: <T>(fn: (db: IFlowDatabase) => Promise<T> | T) =>
			service.transaction(() => fn(adapter)),
		raw: async (query, params) =>
			normalizeRowArray(await service.use(({ raw }) => raw(query, params))),
	};
	return adapter;
};

export const toFlowFileSystem = (
	service: DocumentFileSystem,
): IFlowFileSystem => ({
	readFile: ((path: string, options?: { encoding: string }) => {
		const read = service.readFile(flowFsPathToSandboxPath(path));
		return read.then((bytes: Uint8Array) =>
			options?.encoding
				? new TextDecoder(options.encoding).decode(bytes)
				: bytes,
		);
	}) as IFlowFileSystem["readFile"],
	writeFile: async (path, data) => {
		const bytes =
			typeof data === "string" ? new TextEncoder().encode(data) : data;
		await service.writeFile(flowFsPathToSandboxPath(path), bytes);
	},
	appendFile: async (path, data) => {
		const sandboxPath = flowFsPathToSandboxPath(path);
		const existing = await service.readFile(sandboxPath);
		const suffix =
			typeof data === "string" ? new TextEncoder().encode(data) : data;
		const merged = new Uint8Array(existing.length + suffix.length);
		merged.set(existing);
		merged.set(suffix, existing.length);
		await service.writeFile(sandboxPath, merged);
	},
	unlink: (path) => service.deleteFile(flowFsPathToSandboxPath(path)),
	rename: async (oldPath, newPath) => {
		const oldSandboxPath = flowFsPathToSandboxPath(oldPath);
		const newSandboxPath = flowFsPathToSandboxPath(newPath);
		const node = await getTreeNode(service, oldPath);
		const { parent: oldParent } = splitParentAndName(oldSandboxPath);
		const { parent: newParent, name } = splitParentAndName(newSandboxPath);
		let currentSandboxPath = oldSandboxPath;

		if (oldParent !== newParent) {
			currentSandboxPath = await service.move(oldSandboxPath, newParent);
		}

		if (name !== node.name) {
			await service.rename(currentSandboxPath, name);
		}
	},
	copyFile: async (src, dest) => {
		const bytes = await service.readFile(flowFsPathToSandboxPath(src));
		await service.writeFile(flowFsPathToSandboxPath(dest), bytes);
	},
	mkdir: async (path) => {
		await service.mkdir(flowFsPathToSandboxPath(path));
		return undefined;
	},
	rmdir: (path) => service.deleteFolder(flowFsPathToSandboxPath(path)),
	rm: async (path, options) => {
		const node = await getTreeNode(service, path);
		if (options?.recursive) {
			await (node.type === "folder"
				? service.deleteFolder(flowFsPathToSandboxPath(path))
				: service.deleteFile(flowFsPathToSandboxPath(path)));
			return;
		}
		if (node.type === "folder") {
			throw new Error(`Path is a directory: ${path}`);
		}
		await service.deleteFile(flowFsPathToSandboxPath(path));
	},
	readdir: (async (path: string, options?: { withFileTypes: true }) => {
		const node = await getTreeNode(service, path);
		if (node.type !== "folder") {
			throw new Error(`Path is not a directory: ${path}`);
		}
		const nodes = node.children;
		return options?.withFileTypes
			? nodes.map(toDirEntry)
			: nodes.map((node) => node.name);
	}) as IFlowFileSystem["readdir"],
	stat: async (path) => {
		const node = await getTreeNode(service, path);
		return toFileStat(node.file?.size ?? 0, node.type);
	},
	access: async (path) => {
		await getTreeNode(service, path);
	},
});

export const toFlowWebBrowser = (
	service: IWebBrowserService,
): IFlowWebBrowserService => ({
	isReady: () => service.isReady(),
	getCapabilities: () => ({
		canOpenSession: true,
		canQueryDom: true,
		canPerformDomAction: true,
		canWaitForDom: true,
		canWaitForRender: true,
		canFetchRenderedFallback: true,
		canManageMultipleSessions: true,
	}),
	openSession: async (args) =>
		normalizeWebOpenResult(
			await service.openSession(args as WebOpenSessionArgs),
		),
	refreshSession: (args) =>
		service.refreshSession(args as WebRefreshSessionArgs),
	getOrOpenSession: async (args) =>
		normalizeWebOpenResult(
			await service.getOrOpenSession(args as WebGetOrOpenSessionArgs),
		),
	getAllSessionsInfo: () => service.getAllSessionsInfo(),
	trimToLatestSession: () => service.trimToLatestSession(),
	closeSession: (sessionId) => service.closeSession(sessionId),
	getActiveSessionInfo: () => service.getActiveSessionInfo(),
	fetchRenderedFallback: async (args) => {
		const result = await service.fetchRenderedFallback(
			args as WebFetchRenderedFallbackArgs,
		);
		return result;
	},
	searchInSessionHtml: (args) =>
		service.searchInSessionHtml(args as WebSearchInSessionArgs),
	queryDomElements: (args) =>
		service.queryDomElements(args as WebQueryDomElementsArgs),
	performDomAction: async (args) => ({
		result: await service.performDomAction(args as WebPerformDomActionArgs),
	}),
	waitForDomSelector: async (args) =>
		service.waitForDomSelector(args as WebWaitForSelectorArgs),
	waitForPageRender: async (args: FlowWebRefreshSessionArgs) =>
		service.waitForPageRender(args as WebWaitForRenderArgs),
});

const normalizeSandboxCommand = (
	result: unknown,
	request: SandboxRequest | string,
): SandboxCommandResult => {
	if (isRecord(result) && typeof result.commandId === "string") {
		return result as unknown as SandboxCommandResult;
	}
	const now = Date.now();
	return {
		commandId: "",
		command: typeof request === "string" ? request : "",
		cwd: "",
		status: "completed",
		completed: true,
		stdout:
			isRecord(result) && typeof result.stdout === "string"
				? result.stdout
				: "",
		stderr:
			isRecord(result) && typeof result.stderr === "string"
				? result.stderr
				: "",
		nextOffset: 0,
		exitCode:
			isRecord(result) && typeof result.exitCode === "number"
				? result.exitCode
				: null,
		startedAt: now,
		updatedAt: now,
	};
};

export const toFlowSandbox = (
	service: ISandboxContainerService,
): IFlowSandboxService => ({
	isReady: () => service.isReady(),
	executeCode: (request) =>
		service.executeCode(
			requestObject(request, "code") as unknown as SandboxExecutionRequest,
		),
	executeCommand: async (request) =>
		normalizeSandboxCommand(
			await service.executeCommand(
				requestObject(
					request,
					"command",
				) as unknown as SandboxExecuteCommandRequest,
			),
			request,
		),
	readFile: (request) =>
		service.readFile(
			requestObject(request, "path") as unknown as SandboxFsReadFileRequest,
		),
	writeFile: (request, content) =>
		service.writeFile(
			(typeof request === "string"
				? { path: request, content: content ?? "" }
				: request) as unknown as SandboxFsWriteFileRequest,
		),
	readdir: (request) =>
		service.readdir(
			requestObject(request, "path") as unknown as SandboxFsReaddirRequest,
		),
	mkdir: (request) =>
		service.mkdir(
			requestObject(request, "path") as unknown as SandboxFsMkdirRequest,
		),
	unlink: (request) =>
		service.unlink(
			requestObject(request, "path") as unknown as SandboxFsUnlinkRequest,
		),
	rename: (request, newPath) =>
		service.rename(
			(typeof request === "string"
				? { oldPath: request, newPath: newPath ?? request }
				: request) as unknown as SandboxFsRenameRequest,
		),
	exists: (request) =>
		service.exists(
			requestObject(request, "path") as unknown as SandboxFsExistsRequest,
		),
	installPackage: (request) =>
		service.installPackage(
			(typeof request === "string"
				? { packageSpec: request }
				: request) as unknown as SandboxNpmInstallRequest,
		),
	startServer: (request) =>
		service.startServer(request as unknown as SandboxStartServerRequest),
	stopServer: (request) =>
		service.stopServer(
			(typeof request === "number"
				? { port: request }
				: request) as unknown as SandboxStopServerRequest,
		),
	listServers: () => service.listServers(),
	clearLogs: () => service.clearLogs(),
	getLogs: (args) => service.getLogs(args as SandboxGetLogsRequest),
	fetchResource: (args) =>
		service.fetchResource(args as unknown as SandboxNetworkFetchRequest),
	listCommands: () => service.listCommands(),
	listenCommand: (args) =>
		service.listenCommand(args as unknown as SandboxListenCommandRequest),
	sendCommandInput: async (args) => {
		const result = await service.sendCommandInput(
			args as unknown as SandboxSendCommandInputRequest,
		);
		return {
			commandId:
				isRecord(result) && typeof result.commandId === "string"
					? result.commandId
					: "",
			sent: true,
		};
	},
	stopCommand: async (args) => {
		const result = await service.stopCommand(
			args as unknown as SandboxStopCommandRequest,
		);
		return {
			commandId:
				isRecord(result) && typeof result.commandId === "string"
					? result.commandId
					: "",
			stopped: true,
		};
	},
	requestServer: (args) =>
		service.requestServer(args as unknown as SandboxServerRequest),
	getServerRenderUrl: (args) =>
		service.getServerRenderUrl(
			args as unknown as SandboxServerRenderUrlRequest,
		),
	handleSwRequestWithRetry: (args) =>
		service.handleSwRequestWithRetry(
			args as unknown as SandboxHandleSwRequestPayload,
		),
});

export const toAgentSandbox = (
	service: ISandboxContainerService,
	fileSystem?: IFlowFileSystem,
): IAgentSandboxService => createAgentSandboxService(service, fileSystem);

// ---------------------------------------------------------------------------
// Registration helpers — adapt + register in one call.
// Call these at app startup; then use serviceRegistry.resolveAll() instead of
// assembling AllServices manually.
// ---------------------------------------------------------------------------

export const registerFlowLLM = (service: ILLMService): void =>
	serviceRegistry.registerInstance("llm", toFlowLLM(service));

export const registerFlowFileSystem = (service: DocumentFileSystem): void =>
	serviceRegistry.registerInstance("fs", toFlowFileSystem(service));

export const registerFlowDatabase = (service: IDatabaseService): void =>
	serviceRegistry.registerInstance("database", toFlowDatabase(service));

export const registerFlowEmbedding = (service: IEmbeddingService): void =>
	serviceRegistry.registerInstance("embedding", toFlowEmbedding(service));

export const registerFlowWebBrowser = (service: IWebBrowserService): void =>
	serviceRegistry.registerInstance("webBrowser", toFlowWebBrowser(service));

export const registerFlowSandbox = (
	service: ISandboxContainerService,
): void => {
	serviceRegistry.registerInstance("sandboxContainer", toFlowSandbox(service));
	serviceRegistry.registerInstance(
		"sandboxRuntime",
		toAgentSandbox(service, serviceRegistry.resolve("fs")),
	);
};

// The flow package parses HTML through whatever the host installs, so it stays
// runnable under Node as well as in the browser. Every context this app runs in
// — extension pages, the offscreen document, the desktop and web frontends —
// has DOMParser, so it is wired once here rather than per call site.
setHtmlParser((html) => new DOMParser().parseFromString(html, "text/html"));
