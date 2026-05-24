import type { IDatabaseService } from "@/services/database/interfaces/database-service.interface";
import type { IEmbeddingService } from "@/services/embedding/interfaces/embedding-service.interface";
import type { DocumentFileSystem } from "@/services/filesystem/document-filesystem";
import type { DocumentTreeNode } from "@/types/document-library";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";
import type { ISandboxContainerService } from "@/services/sandbox-container";
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
import type { IFlowDatabase } from "./flows/interfaces/database";
import type { IFlowEmbeddingService } from "./flows/interfaces/embedding";
import type {
	DirEntry,
	FileStat,
	IFlowFileSystem,
} from "./flows/interfaces/filesystem";
import type { IFlowLLMService } from "./flows/interfaces/llm";
import type {
	IFlowSandboxService,
	SandboxRequest,
} from "./flows/interfaces/sandbox";
import type { SandboxCommandResult } from "./flows/interfaces/sandbox";
import type {
	IFlowWebBrowserService,
	WebOpenSessionResult as FlowWebOpenSessionResult,
	WebRefreshSessionArgs as FlowWebRefreshSessionArgs,
	WebRenderedFallbackResult as FlowWebRenderedFallbackResult,
} from "./flows/interfaces/web-browser";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "./flows/interfaces/messages";
import { schema as appDatabaseSchema } from "@/services/database/schema";
import type {
	IKnowledgeDatabase,
	KnowledgeDatabaseContext,
} from "./flows/interfaces/knowledge";

type FlowChatCreate = NonNullable<
	IFlowLLMService["chat"]
>["completions"]["create"];

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

const WORKSPACE_FS_ROOT = "/home/workspace";
const WORKSPACE_SANDBOX_ROOT = "/workspaces";
const DOCUMENTS_FS_ROOT = "/home/documents";

const normalizeFsPath = (path: string): string => {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	return normalized || "/";
};

const workspaceFsPathToSandboxPath = (path: string): string => {
	const normalized = normalizeFsPath(path);
	if (normalized === WORKSPACE_FS_ROOT) return WORKSPACE_SANDBOX_ROOT;
	if (normalized.startsWith(`${WORKSPACE_FS_ROOT}/`)) {
		return `${WORKSPACE_SANDBOX_ROOT}${normalized.slice(WORKSPACE_FS_ROOT.length)}`;
	}
	return normalized.startsWith(WORKSPACE_SANDBOX_ROOT)
		? normalized
		: `${WORKSPACE_SANDBOX_ROOT}${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
};

const documentFsPathToLogicalPath = (path: string): string => {
	const normalized = normalizeFsPath(path);
	if (normalized === DOCUMENTS_FS_ROOT) return "/";
	if (normalized.startsWith(`${DOCUMENTS_FS_ROOT}/`)) {
		return normalized.slice(DOCUMENTS_FS_ROOT.length);
	}
	return normalized;
};

const isWorkspaceFsPath = (path: string): boolean => {
	const normalized = normalizeFsPath(path);
	return (
		normalized === WORKSPACE_FS_ROOT ||
		normalized.startsWith(`${WORKSPACE_FS_ROOT}/`) ||
		normalized === WORKSPACE_SANDBOX_ROOT ||
		normalized.startsWith(`${WORKSPACE_SANDBOX_ROOT}/`)
	);
};

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
	const workspace = isWorkspaceFsPath(path);
	const logicalPath = workspace
		? normalizeFsPath(
				workspaceFsPathToSandboxPath(path).slice(
					WORKSPACE_SANDBOX_ROOT.length,
				) || "/",
			)
		: documentFsPathToLogicalPath(path);
	const tree = workspace
		? await service.getWorkspaceTree()
		: await service.getTree();
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
		const read = isWorkspaceFsPath(path)
			? service.getWorkspaceFileContent(workspaceFsPathToSandboxPath(path))
			: service.getFileContent(documentFsPathToLogicalPath(path));
		return read.then((bytes) =>
			options?.encoding
				? new TextDecoder(options.encoding).decode(bytes)
				: bytes,
		);
	}) as IFlowFileSystem["readFile"],
	writeFile: async (path, data) => {
		const bytes =
			typeof data === "string" ? new TextEncoder().encode(data) : data;
		if (isWorkspaceFsPath(path)) {
			await service.writeWorkspaceFile(
				workspaceFsPathToSandboxPath(path),
				new TextDecoder().decode(bytes),
			);
			return;
		}
		await service.writeFileContent(documentFsPathToLogicalPath(path), bytes);
	},
	appendFile: async (path, data) => {
		const existing = isWorkspaceFsPath(path)
			? await service.getWorkspaceFileContent(
					workspaceFsPathToSandboxPath(path),
				)
			: await service.getFileContent(documentFsPathToLogicalPath(path));
		const suffix =
			typeof data === "string" ? new TextEncoder().encode(data) : data;
		const merged = new Uint8Array(existing.length + suffix.length);
		merged.set(existing);
		merged.set(suffix, existing.length);
		if (isWorkspaceFsPath(path)) {
			await service.writeWorkspaceFile(
				workspaceFsPathToSandboxPath(path),
				new TextDecoder().decode(merged),
			);
			return;
		}
		await service.writeFileContent(documentFsPathToLogicalPath(path), merged);
	},
	unlink: (path) =>
		isWorkspaceFsPath(path)
			? service.deleteWorkspaceFile(workspaceFsPathToSandboxPath(path))
			: service.deleteFileContent(documentFsPathToLogicalPath(path)),
	rename: async (oldPath, newPath) => {
		if (isWorkspaceFsPath(oldPath) || isWorkspaceFsPath(newPath)) {
			const oldSandboxPath = workspaceFsPathToSandboxPath(oldPath);
			const newSandboxPath = workspaceFsPathToSandboxPath(newPath);
			const { parent: oldParent } = splitParentAndName(oldSandboxPath);
			const { parent: newParent, name } = splitParentAndName(newSandboxPath);
			if (oldParent !== newParent) {
				throw new Error("Workspace move across folders is not supported.");
			}
			await service.renameWorkspaceFile(oldSandboxPath, name);
			return;
		}

		const oldLogicalPath = documentFsPathToLogicalPath(oldPath);
		const newLogicalPath = documentFsPathToLogicalPath(newPath);
		const node = await getTreeNode(service, oldLogicalPath);
		const { parent: oldParent } = splitParentAndName(oldLogicalPath);
		const { parent: newParent, name } = splitParentAndName(newLogicalPath);

		if (oldParent !== newParent) {
			if (node.type === "folder") {
				await service.moveFolder(oldLogicalPath, newParent);
			} else {
				await service.moveFile(oldLogicalPath, newParent);
			}
		}

		if (name !== node.name || oldParent !== newParent) {
			const movedPath =
				oldParent === newParent
					? oldLogicalPath
					: newParent === "/"
						? `/${node.name}`
						: `${newParent}/${node.name}`;
			if (name !== node.name) {
				if (node.type === "folder") {
					await service.renameFolder(movedPath, name);
				} else {
					await service.renameFile(movedPath, name);
				}
			}
		}
	},
	copyFile: async (src, dest) => {
		const bytes = isWorkspaceFsPath(src)
			? await service.getWorkspaceFileContent(workspaceFsPathToSandboxPath(src))
			: await service.getFileContent(documentFsPathToLogicalPath(src));
		if (isWorkspaceFsPath(dest)) {
			await service.writeWorkspaceFile(
				workspaceFsPathToSandboxPath(dest),
				new TextDecoder().decode(bytes),
			);
			return;
		}
		await service.writeFileContent(documentFsPathToLogicalPath(dest), bytes);
	},
	mkdir: async (path) => {
		if (isWorkspaceFsPath(path)) {
			await service.mkdirWorkspace(workspaceFsPathToSandboxPath(path));
			return undefined;
		}
		const logicalPath = documentFsPathToLogicalPath(path);
		if (logicalPath === "/") return undefined;
		try {
			const existing = await getTreeNode(service, logicalPath);
			if (existing.type !== "folder") {
				throw new Error(`Path exists and is not a directory: ${path}`);
			}
			return undefined;
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!error.message.startsWith("Path not found:")
			) {
				throw error;
			}
		}
		const { parent, name } = splitParentAndName(logicalPath);
		await service.createFolder(name, parent);
		return undefined;
	},
	rmdir: (path) =>
		isWorkspaceFsPath(path)
			? service.deleteWorkspaceFolder(workspaceFsPathToSandboxPath(path))
			: service.deleteFolder(documentFsPathToLogicalPath(path)),
	rm: async (path, options) => {
		const node = await getTreeNode(service, path);
		if (options?.recursive) {
			if (isWorkspaceFsPath(path)) {
				await service.deleteWorkspaceFolder(workspaceFsPathToSandboxPath(path));
			} else if (node.type === "folder") {
				await service.deleteFolder(documentFsPathToLogicalPath(path));
			} else {
				await service.deleteFile(documentFsPathToLogicalPath(path));
			}
			return;
		}
		if (node.type === "folder") {
			throw new Error(`Path is a directory: ${path}`);
		}
		await (isWorkspaceFsPath(path)
			? service.deleteWorkspaceFile(workspaceFsPathToSandboxPath(path))
			: service.deleteFileContent(documentFsPathToLogicalPath(path)));
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
