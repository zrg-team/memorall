import { logError, logInfo, logWarn } from "@/utils/logger";
import { platform } from "@/platform/current";
import {
	documentFileSystemService,
	type FilesystemChangeEvent,
} from "@/services/filesystem/document-filesystem";
import {
	DOCUMENTS_SANDBOX_ROOT,
	WORKSPACES_SANDBOX_ROOT,
	isDocumentsSandboxPath,
	isWorkspacesSandboxPath,
	normalizeSandboxPath,
	toDocumentsLogicalPath,
} from "@/services/filesystem/sandbox-paths";
import { runHostCommandLine, usesHostCommand } from "./host-commands";
import { createCurlHttp } from "./host-commands/curl/http";
import type { HostFiles } from "./host-commands/types";
import type { ISandboxContainerService } from "./interfaces/sandbox-container-service.interface";
import {
	decodeSwResponseBodyPreview,
	delay,
	getLocalBuildRetryDelayMs,
	hasSwTransformErrorHeader,
	isLikelyPendingLocalBuildResponse,
} from "./sw-response-utils";
import type {
	SandboxCommandResult,
	SandboxErrorEnvelope,
	SandboxExecutionRequest,
	SandboxExecutionResult,
	SandboxFsExistsRequest,
	SandboxFsExistsResult,
	SandboxFsMkdirRequest,
	SandboxFsReadFileRequest,
	SandboxFsReadFileResult,
	SandboxFsReaddirRequest,
	SandboxFsReaddirResult,
	SandboxFsRenameRequest,
	SandboxFsUnlinkRequest,
	SandboxFsWriteFileRequest,
	SandboxListCommandsResult,
	SandboxListServersResult,
	SandboxListenCommandRequest,
	SandboxNpmInstallFromPackageJsonRequest,
	SandboxNpmInstallRequest,
	SandboxNpmInstallResult,
	SandboxNpmListResult,
	SandboxOperation,
	SandboxOperationPayloadMap,
	SandboxOperationResultMap,
	SandboxRequestEnvelope,
	SandboxRestoreSnapshotRequest,
	SandboxRunFileRequest,
	SandboxRunFileResult,
	SandboxSendCommandInputRequest,
	SandboxStartServerRequest,
	SandboxStartServerResult,
	SandboxExecuteCommandRequest,
	SandboxStopCommandRequest,
	SandboxStopServerRequest,
	SandboxGetLogsRequest,
	SandboxGetLogsResult,
	SandboxNetworkFetchRequest,
	SandboxNetworkFetchResult,
	SandboxServerRequest,
	SandboxServerRequestResult,
	SandboxServerRenderUrlRequest,
	SandboxServerRenderUrlResult,
	SandboxHandleSwRequestResult,
	SandboxResponseMessage,
	SandboxWorkspaceOp,
	SandboxFileContent,
} from "./types";

interface PendingRequest {
	timeoutId: number;
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	operation: SandboxOperation;
}

interface RendererPreviewConfig {
	path: string;
	virtualUrl: string;
	rendererUrl: string;
	importMap: Record<string, string>;
}

export interface SandboxContainerInitOptions {
	frameUrl?: string;
	loadTimeoutMs?: number;
	requestTimeoutMs?: number;
}

const SANDBOX_CHANNEL = "memorall-sandbox-container" as const;
const DEFAULT_FRAME_URL = "sandbox/pages/sandbox-container-runtime.html";
const DEFAULT_LOAD_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_WAIT_TIMEOUT_MS = 10_000;
const COMMAND_REQUEST_TIMEOUT_BUFFER_MS = 5_000;
const EMPTY_LOCAL_BUILD_RETRY_ATTEMPTS = 20;
const SANDBOX_RUNTIME_WORKSPACE_SYNC = "memorall-sandbox-workspace-sync";
const SANDBOX_PREVIEW_RELAY_CHANNEL = "memorall-sandbox-preview-relay";
/** The runtime posts this when sandbox code has queued workspace writes. */
const WORKSPACE_OPS_PENDING_CHANNEL = "memorall-sandbox-fs-pending";
/**
 * Limits on copying file contents into the runtime ahead of use. Files past
 * them stay on the on-demand paths (lazy retry, direct SW fallback).
 */
const WORKSPACE_PRELOAD_MAX_FILE_BYTES = 1024 * 1024;
const WORKSPACE_PRELOAD_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const WORKSPACE_PRELOAD_MAX_FILES = 2_000;
const WORKSPACE_PRELOAD_BATCH_SIZE = 25;
/**
 * How long a change the sandbox saved to the host is remembered, so the change
 * event it raises on the host is not sent back to the sandbox as news.
 */
const SANDBOX_ECHO_TTL_MS = 10_000;

const hasPathSegment = (path: string, segment: string): boolean =>
	path.split("/").includes(segment);

interface RuntimeWorkspaceChange {
	operation: "write" | "delete" | "rename" | "mkdir";
	path?: string;
	oldPath?: string;
	newPath?: string;
	content?: SandboxFileContent;
}

/**
 * A file's content as the sandbox takes it: text as a string, and a file that
 * is not UTF-8 text (an image, a font) as its bytes, which decoding would ruin.
 */
const sandboxFileContent = (bytes: Uint8Array): SandboxFileContent => {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return bytes;
	}
};

const sameFileContent = (
	left: SandboxFileContent,
	right: SandboxFileContent,
): boolean => {
	if (typeof left === "string" || typeof right === "string") {
		return left === right;
	}
	return (
		left.byteLength === right.byteLength &&
		left.every((byte, index) => byte === right[index])
	);
};

const DIRECT_WORKSPACE_CONTENT_TYPES: Record<string, string> = {
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
};

/**
 * Resolves the worker of one specific registration once it is activated.
 * `navigator.serviceWorker.ready` cannot be used for this: it answers for the
 * registration controlling the page, and the Web build also has an application
 * shell worker registered at a broader scope.
 */
const waitForActiveWorker = (
	registration: ServiceWorkerRegistration,
): Promise<ServiceWorker | null> => {
	if (registration.active) return Promise.resolve(registration.active);
	const pending = registration.installing ?? registration.waiting;
	if (!pending) return Promise.resolve(null);
	return new Promise((resolve) => {
		const check = () => {
			if (pending.state === "activated") {
				pending.removeEventListener("statechange", check);
				resolve(pending);
				return;
			}
			if (pending.state === "redundant") {
				pending.removeEventListener("statechange", check);
				resolve(registration.active ?? null);
			}
		};
		pending.addEventListener("statechange", check);
		check();
	});
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isSandboxResponseMessage = (
	value: unknown,
): value is SandboxResponseMessage<SandboxOperation> => {
	if (!isObject(value)) {
		return false;
	}
	return (
		value.channel === SANDBOX_CHANNEL &&
		value.direction === "response" &&
		typeof value.requestId === "string" &&
		typeof value.operation === "string"
	);
};

const isSandboxErrorEnvelope = (
	value: SandboxResponseMessage<SandboxOperation>,
): value is SandboxErrorEnvelope<SandboxOperation> => value.ok === false;

export class SandboxContainerServiceMain implements ISandboxContainerService {
	private static instance: SandboxContainerServiceMain;

	private iframe: HTMLIFrameElement | null = null;
	private initialized = false;
	private initializing: Promise<void> | null = null;
	private initializedAt: number | null = null;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly options: Required<SandboxContainerInitOptions>;
	private mountDocumentsSyncPromise: Promise<void> | null = null;
	private mountWorkspaceSyncPromise: Promise<void> | null = null;
	private workspaceMountSynced = false;
	private hostFiles: HostFiles | null = null;
	private fsChangeUnsubscribe: (() => void) | null = null;
	private workspaceHotReloadTimer: number | null = null;
	private readonly pendingWorkspaceChanges = new Map<
		string,
		FilesystemChangeEvent
	>();
	/** Set by a change with no path: the whole mount must be read again. */
	private pendingWorkspaceFullResync = false;
	/**
	 * Saving sandbox writes and pushing host changes both go through this
	 * chain, so a host snapshot is never taken while sandbox writes are half
	 * saved (the runtime would drop the files missing from it).
	 */
	private workspaceSyncChain: Promise<unknown> = Promise.resolve();
	private readonly sandboxOriginChanges = new Map<
		string,
		{ content?: SandboxFileContent; expiresAt: number }
	>();
	private workspaceFileSizes = new Map<string, number>();
	private readonly workspacePreloads = new Map<string, Promise<void>>();
	private workspacePreload: Promise<void> | null = null;
	/** Relay channel: port1 stays here, port2 is transferred to the SW as mainPort. */
	private swRelayChannel: MessageChannel | null = null;
	private swRelayReady: Promise<void> | null = null;
	private swBroadcastChannel: BroadcastChannel | null = null;
	/** Last known active service worker — used to re-init relay if SW restarts. */
	private swInstance: ServiceWorker | null = null;
	/** Keepalive timer — sends a periodic ping to prevent Chrome from killing the SW. */
	private swKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

	private constructor(options: SandboxContainerInitOptions = {}) {
		this.options = {
			frameUrl: options.frameUrl ?? DEFAULT_FRAME_URL,
			loadTimeoutMs: options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
			requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		};
	}

	static getInstance(
		options?: SandboxContainerInitOptions,
	): SandboxContainerServiceMain {
		if (!SandboxContainerServiceMain.instance) {
			SandboxContainerServiceMain.instance = new SandboxContainerServiceMain(
				options,
			);
		}
		return SandboxContainerServiceMain.instance;
	}

	isReady(): boolean {
		return this.initialized && this.iframe !== null;
	}

	getInitializedAt(): number | null {
		return this.initializedAt;
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}
		if (this.initializing) {
			return this.initializing;
		}

		this.initializing = this.initializeInternal();
		try {
			await this.initializing;
		} finally {
			this.initializing = null;
		}
	}

	private async initializeInternal(): Promise<void> {
		if (typeof window === "undefined" || typeof document === "undefined") {
			throw new Error("SandboxContainerService requires DOM APIs.");
		}
		this.ensureSwBroadcastRelay();

		// Register the AlmostNode service worker from this outer (non-sandboxed)
		// page so it can control the sandbox iframe context. Manifest sandbox pages
		// have null origin and cannot register service workers themselves.
		await this.registerSandboxServiceWorker();

		window.addEventListener("message", this.onMessage);
		window.addEventListener("message", this.onFsMessage);
		if (!this.fsChangeUnsubscribe) {
			this.fsChangeUnsubscribe = documentFileSystemService.onFilesystemChanged(
				(change) => this.queueWorkspaceHotReload(change),
			);
		}

		const iframe = document.createElement("iframe");
		iframe.style.display = "none";
		const manifest =
			platform.environment === "extension"
				? ((await fetch(platform.assets.url("manifest.json")).then(
						(response) => {
							if (!response.ok) {
								throw new Error(
									`Failed to read extension manifest: ${response.status}`,
								);
							}
							return response.json();
						},
					)) as { sandbox?: { pages?: string[] } })
				: { sandbox: { pages: [this.options.frameUrl] } };
		const manifestSandboxPages = manifest.sandbox?.pages ?? [];
		const runtimePage =
			manifestSandboxPages.find((page) =>
				page.includes("sandbox-container-runtime"),
			) ?? manifestSandboxPages.at(-1);
		iframe.src = platform.assets.url(runtimePage ?? this.options.frameUrl);

		const loaded = new Promise<void>((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				reject(
					new Error(
						`Sandbox iframe load timeout after ${this.options.loadTimeoutMs}ms`,
					),
				);
			}, this.options.loadTimeoutMs);

			iframe.addEventListener(
				"load",
				() => {
					window.clearTimeout(timeoutId);
					resolve();
				},
				{ once: true },
			);

			iframe.addEventListener(
				"error",
				() => {
					window.clearTimeout(timeoutId);
					reject(new Error("Sandbox iframe failed to load."));
				},
				{ once: true },
			);
		});

		try {
			document.body.appendChild(iframe);
			await loaded;

			this.iframe = iframe;
			this.initialized = true;
			this.initializedAt = Date.now();

			await this.request("health", undefined, 10_000);
			logInfo("✅ SandboxContainerService initialized");
		} catch (error) {
			iframe.remove();
			this.iframe = null;
			this.initialized = false;
			this.initializedAt = null;
			window.removeEventListener("message", this.onMessage);
			throw error;
		}
	}

	/**
	 * Register the AlmostNode service worker from this outer (non-sandboxed) page
	 * and set up a relay channel so the SW can route /__virtual__/<port>/ requests
	 * through the sandbox iframe's AlmostNode bridge.
	 *
	 * Manifest sandbox pages (pages/sandbox-container-runtime.html) have a sandboxed
	 * browsing context and can never register service workers themselves, so
	 * registration must happen here in the extension popup context.
	 */
	private async registerSandboxServiceWorker(): Promise<void> {
		if (!("serviceWorker" in navigator)) {
			logWarn("[SW] navigator.serviceWorker not available");
			return;
		}
		try {
			const swUrl = platform.assets.url("sandbox/__sw__.js");
			const reg = await navigator.serviceWorker.register(swUrl);
			logInfo(
				"[SW] Registered sandbox service worker, scope:",
				reg.scope,
				swUrl,
			);

			// Wait for this worker to become active. `navigator.serviceWorker.ready`
			// and `.controller` answer for whichever registration controls the
			// current page, which on the Web build is the application shell worker
			// at ./ rather than this one at ./sandbox/ — sending the relay port
			// there would hand it to a worker that never answers the handshake.
			const sw = await waitForActiveWorker(reg);
			if (!sw) {
				logWarn(
					"[SW] No active SW found after ready — page reload may be needed",
				);
				return;
			}

			await this.initSwRelay(sw);

			// Re-init the relay when a newer sandbox worker takes over, which drops
			// the mainPort held by the previous one.
			reg.addEventListener("updatefound", () => {
				const installing = reg.installing;
				if (!installing) return;
				installing.addEventListener("statechange", () => {
					if (installing.state !== "activated") return;
					logInfo("[SW] Sandbox worker replaced — re-initialising relay");
					void this.initSwRelay(installing, true).catch((error) =>
						logWarn("[SW] Failed to re-initialise relay", error),
					);
				});
			});

			// SW asks clients to re-send init when it loses its mainPort.
			// NOTE: offscreen documents are NOT in the SW scope (/sandbox/),
			// so navigator.serviceWorker.controller is always null here.
			// We must use this.swInstance (stored during registration).
			navigator.serviceWorker.addEventListener(
				"message",
				(event: MessageEvent) => {
					if (event.data?.type === "sw-needs-init") {
						const activeSw = this.swInstance;
						if (activeSw) {
							void this.initSwRelay(activeSw, true).catch((error) =>
								logWarn("[SW] Failed to recover relay", error),
							);
						}
					}
				},
			);
		} catch (err) {
			logWarn("[SW] Service worker registration failed:", err);
		}
	}

	private initSwRelay(sw: ServiceWorker, force = false): Promise<void> {
		if (!force && this.swInstance === sw && this.swRelayReady) {
			return this.swRelayReady;
		}
		this.swInstance = sw;
		// Close any previous relay channel.
		if (this.swRelayChannel) {
			this.swRelayChannel.port1.close();
		}
		this.swRelayChannel = new MessageChannel();

		const ready = new Promise<void>((resolve, reject) => {
			const timeoutId = window.setTimeout(
				() =>
					reject(
						new Error("Sandbox service-worker relay handshake timed out."),
					),
				5_000,
			);
			this.swRelayChannel!.port1.onmessage = (event: MessageEvent) => {
				if (event.data?.type === "relay-ready") {
					window.clearTimeout(timeoutId);
					resolve();
					return;
				}
				void this.relaySwMessage(event.data);
			};
		});
		this.swRelayChannel.port1.start();

		// Send port2 to SW — it becomes mainPort inside __sw__.js.
		sw.postMessage({ type: "init" }, [this.swRelayChannel.port2]);
		logInfo("[SW] Relay channel initialised");

		// Keep the SW alive with a periodic ping so Chrome doesn't kill it and
		// lose mainPort. The SW ignores the message type; receiving any message
		// resets Chrome's idle-kill timer (~30 s). We ping every 20 s.
		if (this.swKeepaliveTimer) clearInterval(this.swKeepaliveTimer);
		this.swKeepaliveTimer = setInterval(() => {
			sw.postMessage({ type: "keepalive" });
		}, 20_000);
		this.swRelayReady = ready;
		void ready.catch(() => {
			if (this.swRelayReady === ready) {
				this.swRelayReady = null;
			}
		});
		return ready;
	}

	private ensureSwBroadcastRelay(): void {
		if (this.swBroadcastChannel || typeof BroadcastChannel === "undefined")
			return;
		this.swBroadcastChannel = new BroadcastChannel(
			SANDBOX_PREVIEW_RELAY_CHANNEL,
		);
		this.swBroadcastChannel.onmessage = (event: MessageEvent) => {
			void this.relaySwMessage(event.data, (message) =>
				this.swBroadcastChannel?.postMessage(message),
			);
		};
	}

	/**
	 * Call server.handleSwRequest and retry once if a workspace file needs
	 * materialization. This covers both explicit HTTP failures and Vite/Next
	 * transform errors, which come back as 200 + X-Transform-Error.
	 * Used by both relaySwMessage (SW mainPort path) and renderViaIframe messageHandler.
	 */
	async handleSwRequestWithRetry(params: {
		id: number;
		port: number;
		method: string;
		path: string;
		headers: Record<string, string>;
		body: ArrayBuffer | null;
	}): Promise<SandboxHandleSwRequestResult> {
		const makeRequest = () =>
			this.request(
				"server.handleSwRequest",
				{
					id: params.id,
					port: params.port,
					method: params.method,
					path: params.path,
					headers: params.headers,
					body: params.body,
				},
				120_000,
			);

		const retriedMissingPaths = new Set<string>();
		let lastResult: SandboxHandleSwRequestResult | null = null;

		for (
			let attempt = 0;
			attempt <= EMPTY_LOCAL_BUILD_RETRY_ATTEMPTS;
			attempt++
		) {
			const result = await makeRequest();
			lastResult = result;
			const shouldInspectBody =
				(result.statusCode ?? 200) >= 400 || hasSwTransformErrorHeader(result);

			if (shouldInspectBody) {
				const bodyText = decodeSwResponseBodyPreview(result, 1200);
				const transformError = hasSwTransformErrorHeader(result);

				logInfo(
					`[SW relay] ${params.method} ${params.path} → ${result.statusCode ?? 200} | transformError=${transformError} | bodyBase64 length=${result.bodyBase64?.length ?? 0} | bodyText=${bodyText || "(empty)"}`,
				);

				const missingPath = this.extractUnmaterializedWorkspacePath(bodyText);
				if (missingPath && !retriedMissingPaths.has(missingPath)) {
					retriedMissingPaths.add(missingPath);
					logInfo(
						`[SW relay] materializing ${missingPath} and retrying ${params.method} ${params.path}`,
					);
					await this.materializeMountedDocumentFile(
						this.toWorkspaceCanonicalPath(missingPath),
					);
					continue;
				}
				if (missingPath && retriedMissingPaths.has(missingPath)) {
					const directResponse = await this.tryServeDirectWorkspaceFile({
						method: params.method,
						missingPath,
					});
					if (directResponse) {
						return directResponse;
					}
				}

				if ((result.statusCode ?? 200) >= 400 || transformError) {
					logError(
						`[SW relay] ${params.method} ${params.path} → ${result.statusCode ?? 200} no retry match`,
						bodyText || "(no body)",
					);
				}
			}

			if (
				attempt < EMPTY_LOCAL_BUILD_RETRY_ATTEMPTS &&
				isLikelyPendingLocalBuildResponse(result, params)
			) {
				const delayMs = getLocalBuildRetryDelayMs(attempt);
				logInfo(
					`[SW relay] ${params.method} ${params.path} returned empty build asset; retrying in ${delayMs}ms (${attempt + 1}/${EMPTY_LOCAL_BUILD_RETRY_ATTEMPTS})`,
				);
				await delay(delayMs);
				continue;
			}

			return result;
		}

		return lastResult ?? makeRequest();
	}

	private async relaySwMessage(
		msg: {
			type: string;
			id: number;
			data: {
				port: number;
				method: string;
				url: string;
				headers: Record<string, string>;
				body: ArrayBuffer | null;
			};
		},
		reply: (message: unknown) => void = (message) =>
			this.swRelayChannel?.port1.postMessage(message),
	): Promise<void> {
		if (msg.type !== "request") return;
		const { id, data } = msg;
		try {
			const result = await this.handleSwRequestWithRetry({
				id,
				port: data.port,
				method: data.method,
				path: data.url,
				headers: data.headers ?? {},
				body: data.body ?? null,
			});
			reply({
				type: "response",
				id,
				data: result,
			});
		} catch (err) {
			logError(`[SW relay] ${data.method} ${data.url} → error`, err);
			reply({
				type: "response",
				id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// ── VFS bridge ───────────────────────────────────────────────────────────
	// The sandbox VFS posts memorall-sandbox-fs-req / memorall-sandbox-fs-notify
	// messages so workspace writes/reads go through documentFileSystemService
	// for persistence rather than staying in-memory only.

	private onFsMessage = (event: MessageEvent<unknown>): void => {
		if (event.source !== this.iframe?.contentWindow) return;
		const data = event.data as Record<string, unknown> | null;
		if (!data || typeof data !== "object") return;

		if (data["channel"] === "memorall-sandbox-fs-req") {
			void this.handleFsAsyncRequest(
				data as {
					requestId: string;
					operation: string;
					payload: Record<string, unknown>;
				},
			);
			return;
		}
		if (data["channel"] === "memorall-sandbox-fs-notify") {
			this.handleFsNotify(
				data as { operation: string; payload: Record<string, unknown> },
			);
			return;
		}
		if (data["channel"] === WORKSPACE_OPS_PENDING_CHANNEL) {
			void this.flushWorkspaceWrites().catch((error) =>
				logWarn("Failed to flush workspace writes while running", { error }),
			);
		}
	};

	private async handleFsAsyncRequest(req: {
		requestId: string;
		operation: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		if (!this.iframe?.contentWindow) return;
		try {
			const result = await this.dispatchFsToDocumentService(
				req.operation,
				req.payload,
			);
			this.iframe.contentWindow.postMessage(
				{
					channel: "memorall-sandbox-fs-res",
					requestId: req.requestId,
					ok: true,
					result,
				},
				"*",
			);
		} catch (err) {
			this.iframe.contentWindow.postMessage(
				{
					channel: "memorall-sandbox-fs-res",
					requestId: req.requestId,
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				},
				"*",
			);
		}
	}

	private handleFsNotify(msg: {
		operation: string;
		payload: Record<string, unknown>;
	}): void {
		void this.dispatchFsToDocumentService(msg.operation, msg.payload).catch(
			(err) => {
				logWarn("[sandbox-fs-notify] failed", {
					operation: msg.operation,
					err,
				});
			},
		);
	}

	private async dispatchFsToDocumentService(
		operation: string,
		payload: Record<string, unknown>,
	): Promise<unknown> {
		const rawPath =
			operation === "fs.rename" ? payload["oldPath"] : payload["path"];
		const path = this.toWorkspaceCanonicalPath(
			this.normalizeVirtualPath(String(rawPath ?? "")),
		);
		switch (operation) {
			case "fs.readFile": {
				await this.syncDocumentsMount();
				const bytes = await documentFileSystemService.readFile(path);
				return { content: sandboxFileContent(bytes) };
			}
			case "fs.writeFile": {
				const content = payload["content"];
				await documentFileSystemService.writeFile(
					path,
					content instanceof Uint8Array ? content : String(content ?? ""),
				);
				return { path };
			}
			case "fs.mkdir": {
				await documentFileSystemService.mkdir(path);
				return { path };
			}
			case "fs.unlink": {
				await documentFileSystemService.deleteFile(path);
				return { path };
			}
			case "fs.rename": {
				const newPath = this.toWorkspaceCanonicalPath(
					this.normalizeVirtualPath(String(payload["newPath"] ?? "")),
				);
				await documentFileSystemService.renamePath(path, newPath);
				return { oldPath: path, newPath };
			}
			default:
				throw new Error(`Unknown fs bridge operation: ${operation}`);
		}
	}

	// ── End VFS bridge ────────────────────────────────────────────────────────

	private onMessage = (event: MessageEvent<unknown>): void => {
		if (!this.iframe?.contentWindow) {
			return;
		}
		if (event.source !== this.iframe.contentWindow) {
			return;
		}
		if (!isSandboxResponseMessage(event.data)) {
			return;
		}

		const envelope = event.data;
		const pending = this.pending.get(envelope.requestId);
		if (!pending) {
			return;
		}

		window.clearTimeout(pending.timeoutId);
		this.pending.delete(envelope.requestId);

		if (isSandboxErrorEnvelope(envelope)) {
			const remoteStack = envelope.error.stack
				? `\nRemote sandbox stack:\n${envelope.error.stack}`
				: "";
			pending.reject(
				new Error(
					`Sandbox operation failed (${envelope.operation}): ${envelope.error.message}${remoteStack}`,
				),
			);
			return;
		}

		pending.resolve(envelope.result);
	};

	private queueWorkspaceHotReload(change: FilesystemChangeEvent | null): void {
		// The runtime mounts the whole filesystem at "/", so a change in any
		// scope is a change the sandbox can see. A change with no path is one
		// nobody can describe (a mount appearing, a git checkout): read it all.
		if (!change) {
			this.pendingWorkspaceFullResync = true;
		} else {
			const key =
				change.operation === "rename" || change.operation === "move"
					? `${change.operation}:${change.oldPath ?? ""}->${change.newPath ?? ""}`
					: `${change.operation}:${change.path ?? ""}`;
			this.pendingWorkspaceChanges.set(key, change);
		}
		if (this.workspaceHotReloadTimer !== null) {
			window.clearTimeout(this.workspaceHotReloadTimer);
		}
		this.workspaceHotReloadTimer = window.setTimeout(() => {
			this.workspaceHotReloadTimer = null;
			void this.flushWorkspaceHotReload();
		}, 120);
	}

	private flushWorkspaceHotReload(): Promise<void> {
		return this.enqueueWorkspaceSync(() => this.pushWorkspaceHotReload());
	}

	private async pushWorkspaceHotReload(): Promise<void> {
		const fullResync = this.pendingWorkspaceFullResync;
		this.pendingWorkspaceFullResync = false;
		const changes = Array.from(this.pendingWorkspaceChanges.values());
		this.pendingWorkspaceChanges.clear();

		if (!this.initialized || !this.iframe?.contentWindow) {
			return;
		}
		if (!fullResync && changes.length === 0) {
			return;
		}

		try {
			if (fullResync || !this.workspaceMountSynced) {
				await this.mountWorkspaceNow();
				return;
			}

			const snapshot =
				await documentFileSystemService.getSandboxWorkspaceMountSnapshot();
			const { changes: runtimeChanges, onlyEchoes } =
				await this.buildRuntimeWorkspaceChanges(
					changes,
					new Set(snapshot.files),
				);
			// Every change was the sandbox's own write coming back: it already
			// has all of it, and a snapshot push would only cost a re-render.
			if (onlyEchoes) {
				return;
			}
			this.rememberWorkspaceFileSizes(snapshot.fileSizes);
			this.iframe.contentWindow.postMessage(
				{
					type: SANDBOX_RUNTIME_WORKSPACE_SYNC,
					mode: "incremental",
					snapshot: {
						directories: snapshot.directories,
						files: snapshot.files,
					},
					changes: runtimeChanges,
				},
				"*",
			);
		} catch (error) {
			logWarn("Failed to flush workspace hot reload update", error);
		}
	}

	private async buildRuntimeWorkspaceChanges(
		changes: FilesystemChangeEvent[],
		knownFiles: Set<string>,
	): Promise<{ changes: RuntimeWorkspaceChange[]; onlyEchoes: boolean }> {
		const runtimeChanges: RuntimeWorkspaceChange[] = [];
		let onlyEchoes = true;

		for (const change of changes) {
			if (
				(change.operation === "rename" || change.operation === "move") &&
				change.newPath
			) {
				const oldPath = change.oldPath
					? this.toWorkspaceCanonicalPath(
							this.normalizeVirtualPath(change.oldPath),
						)
					: undefined;
				const newPath = this.toWorkspaceCanonicalPath(
					this.normalizeVirtualPath(change.newPath),
				);
				if (this.consumeSandboxEcho(`rename:${oldPath ?? ""}->${newPath}`)) {
					continue;
				}
				onlyEchoes = false;
				let content: SandboxFileContent | undefined;
				if (knownFiles.has(newPath)) {
					try {
						const bytes = await documentFileSystemService.readFile(newPath);
						content = sandboxFileContent(bytes);
					} catch {
						content = undefined;
					}
				}
				runtimeChanges.push({ operation: "rename", oldPath, newPath, content });
				continue;
			}

			if (!change.path) {
				onlyEchoes = false;
				continue;
			}

			const path = this.toWorkspaceCanonicalPath(
				this.normalizeVirtualPath(change.path),
			);
			if (change.operation === "write" || change.operation === "create") {
				let content: SandboxFileContent = "";
				try {
					const bytes = await documentFileSystemService.readFile(path);
					content = sandboxFileContent(bytes);
				} catch {
					// A folder, or a file already gone: the snapshot covers both.
					onlyEchoes = false;
					continue;
				}
				if (this.consumeSandboxEcho(`write:${path}`, content)) {
					continue;
				}
				onlyEchoes = false;
				runtimeChanges.push({ operation: "write", path, content });
				continue;
			}

			if (change.operation === "delete" || change.operation === "mkdir") {
				if (this.consumeSandboxEcho(`${change.operation}:${path}`)) {
					continue;
				}
				onlyEchoes = false;
				runtimeChanges.push({ operation: change.operation, path });
				continue;
			}

			onlyEchoes = false;
		}

		return { changes: runtimeChanges, onlyEchoes };
	}

	/** Note a sandbox change about to be saved, so its echo can be recognised. */
	private rememberSandboxChange(op: SandboxWorkspaceOp): void {
		const now = Date.now();
		if (this.sandboxOriginChanges.size > 500) {
			for (const [key, entry] of this.sandboxOriginChanges) {
				if (entry.expiresAt < now) this.sandboxOriginChanges.delete(key);
			}
		}
		const expiresAt = now + SANDBOX_ECHO_TTL_MS;
		if (op.op === "write") {
			this.sandboxOriginChanges.set(`write:${op.path}`, {
				content: op.content,
				expiresAt,
			});
		} else if (op.op === "rename") {
			this.sandboxOriginChanges.set(`rename:${op.oldPath}->${op.newPath}`, {
				expiresAt,
			});
		} else {
			this.sandboxOriginChanges.set(`${op.op}:${op.path}`, { expiresAt });
		}
	}

	/**
	 * Whether a host change is the echo of one the sandbox made. A write only
	 * counts when the host still holds exactly what the sandbox wrote.
	 */
	private consumeSandboxEcho(
		key: string,
		content?: SandboxFileContent,
	): boolean {
		const entry = this.sandboxOriginChanges.get(key);
		if (!entry) return false;
		this.sandboxOriginChanges.delete(key);
		if (entry.expiresAt < Date.now()) return false;
		return (
			entry.content === undefined ||
			(content !== undefined && sameFileContent(entry.content, content))
		);
	}

	private enqueueWorkspaceSync<T>(task: () => Promise<T>): Promise<T> {
		const run = this.workspaceSyncChain.then(task);
		this.workspaceSyncChain = run.catch(() => undefined);
		return run;
	}

	private rememberWorkspaceFileSizes(sizes?: Record<string, number>): void {
		this.workspaceFileSizes = new Map(Object.entries(sizes ?? {}));
	}

	/**
	 * Copy file contents into the runtime ahead of use. Sandbox code reads
	 * files synchronously, and the host can only answer asynchronously, so a
	 * file the runtime holds no content for cannot be fetched at the moment it
	 * is read. Only files the runtime lacks are read, and the runtime keeps any
	 * content that arrived first.
	 */
	private async preloadWorkspaceFiles(
		root: string,
		includeDependencies: boolean,
	): Promise<void> {
		const listed = await this.request("fs.listUnmaterializedWorkspaceFiles", {
			path: root,
		});
		const candidates = (listed?.files ?? [])
			.filter(
				(path) =>
					!hasPathSegment(path, ".git") &&
					(includeDependencies || !hasPathSegment(path, "node_modules")) &&
					(this.workspaceFileSizes.get(path) ?? 0) <=
						WORKSPACE_PRELOAD_MAX_FILE_BYTES,
			)
			// Project files first: a dependency tree can use up the budget alone.
			.sort(
				(left, right) =>
					Number(hasPathSegment(left, "node_modules")) -
					Number(hasPathSegment(right, "node_modules")),
			)
			.slice(0, WORKSPACE_PRELOAD_MAX_FILES);

		const waits: Promise<void>[] = [];
		const toLoad: string[] = [];
		for (const path of candidates) {
			const inFlight = this.workspacePreloads.get(path);
			if (inFlight) waits.push(inFlight);
			else toLoad.push(path);
		}

		let budget = WORKSPACE_PRELOAD_MAX_TOTAL_BYTES;
		let previous: Promise<void> = Promise.resolve();
		for (let i = 0; i < toLoad.length; i += WORKSPACE_PRELOAD_BATCH_SIZE) {
			const batch = toLoad.slice(i, i + WORKSPACE_PRELOAD_BATCH_SIZE);
			const loaded = previous
				.then(async () => {
					if (budget <= 0) return;
					const reads = await Promise.all(
						batch.map((path) =>
							documentFileSystemService.readFile(path).then(
								(bytes) => ({ path, bytes }),
								() => null,
							),
						),
					);
					const files: Array<{ path: string; content: SandboxFileContent }> =
						[];
					for (const read of reads) {
						if (!read) continue;
						const size = read.bytes.byteLength;
						if (size > WORKSPACE_PRELOAD_MAX_FILE_BYTES || size > budget) {
							continue;
						}
						budget -= size;
						files.push({
							path: read.path,
							content: sandboxFileContent(read.bytes),
						});
					}
					if (files.length > 0) {
						await this.request("fs.materializeWorkspaceFiles", { files });
					}
				})
				.catch((error) => {
					logWarn("Failed to preload workspace files", { root, error });
				});
			for (const path of batch) this.workspacePreloads.set(path, loaded);
			void loaded.then(() => {
				for (const path of batch) {
					if (this.workspacePreloads.get(path) === loaded) {
						this.workspacePreloads.delete(path);
					}
				}
			});
			waits.push(loaded);
			previous = loaded;
		}

		await Promise.all(waits);
	}

	private buildRequest<T extends SandboxOperation>(
		operation: T,
		payload: SandboxOperationPayloadMap[T],
	): SandboxRequestEnvelope<T> {
		return {
			channel: SANDBOX_CHANNEL,
			direction: "request",
			requestId: crypto.randomUUID(),
			operation,
			payload,
		};
	}

	async request<T extends SandboxOperation>(
		operation: T,
		payload: SandboxOperationPayloadMap[T],
		timeoutMs: number = this.options.requestTimeoutMs,
	): Promise<SandboxOperationResultMap[T]> {
		await this.initialize();
		if (!this.iframe?.contentWindow) {
			throw new Error("Sandbox iframe is not available.");
		}

		const request = this.buildRequest(operation, payload);

		return new Promise<SandboxOperationResultMap[T]>((resolve, reject) => {
			const timeoutId = window.setTimeout(() => {
				this.pending.delete(request.requestId);
				reject(
					new Error(
						`Sandbox request timed out (${operation}) after ${timeoutMs}ms`,
					),
				);
			}, timeoutMs);

			this.pending.set(request.requestId, {
				timeoutId,
				resolve: (value) => resolve(value as SandboxOperationResultMap[T]),
				reject,
				operation,
			});

			this.iframe?.contentWindow?.postMessage(request, "*");
		});
	}

	private resolveCommandRequestTimeout(waitTimeoutMs?: number): number {
		const normalizedWaitTimeout = Number.isFinite(waitTimeoutMs)
			? Math.max(0, Math.floor(waitTimeoutMs!))
			: DEFAULT_COMMAND_WAIT_TIMEOUT_MS;
		return Math.max(
			this.options.requestTimeoutMs,
			normalizedWaitTimeout + COMMAND_REQUEST_TIMEOUT_BUFFER_MS,
		);
	}

	private async prepareCommandExecution(
		request: SandboxExecuteCommandRequest,
	): Promise<SandboxExecuteCommandRequest> {
		await Promise.all([this.syncDocumentsMount(), this.syncWorkspaceMount()]);
		const cwd = request.cwd
			? this.toWorkspaceCanonicalPath(this.normalizeVirtualPath(request.cwd))
			: undefined;

		// A shell command reads files synchronously, with no way to fetch one it
		// lacks, so its files must be in the runtime before it starts. The
		// working directory is loaded in full, dependencies included, since that
		// is where `node server.js` will look for `require`d files.
		await this.workspacePreload;
		const cdTarget = /^\s*cd\s+([^;&|]+?)\s*&&/
			.exec(request.command)?.[1]
			.replace(/^(["'])(.*)\1$/, "$2");
		const workDir = cdTarget
			? this.toWorkspaceCanonicalPath(
					cdTarget.startsWith("/") ? cdTarget : `${cwd ?? "/"}/${cdTarget}`,
				)
			: cwd;
		if (workDir && workDir !== "/") {
			await this.preloadWorkspaceFiles(workDir, true).catch((error) =>
				logWarn("Failed to preload the command's working directory", {
					workDir,
					error,
				}),
			);
		}

		return { ...request, cwd };
	}

	async dispose(): Promise<void> {
		for (const [, pending] of this.pending) {
			window.clearTimeout(pending.timeoutId);
			pending.reject(new Error("Sandbox service disposed."));
		}
		this.pending.clear();
		this.pendingWorkspaceChanges.clear();
		this.resetWorkspaceSyncState();
		if (this.workspaceHotReloadTimer !== null) {
			window.clearTimeout(this.workspaceHotReloadTimer);
			this.workspaceHotReloadTimer = null;
		}
		if (this.swKeepaliveTimer !== null) {
			clearInterval(this.swKeepaliveTimer);
			this.swKeepaliveTimer = null;
		}
		this.swRelayChannel?.port1.close();
		this.swRelayChannel = null;
		this.swRelayReady = null;
		this.swInstance = null;
		this.swBroadcastChannel?.close();
		this.swBroadcastChannel = null;
		this.workspaceMountSynced = false;
		if (this.fsChangeUnsubscribe) {
			this.fsChangeUnsubscribe();
			this.fsChangeUnsubscribe = null;
		}

		if (typeof window !== "undefined") {
			window.removeEventListener("message", this.onMessage);
			window.removeEventListener("message", this.onFsMessage);
		}

		if (this.iframe) {
			this.iframe.remove();
			this.iframe = null;
		}

		this.initialized = false;
		this.initializedAt = null;
		logInfo("🧹 SandboxContainerService disposed");
	}

	private resetWorkspaceSyncState(): void {
		this.pendingWorkspaceFullResync = false;
		this.sandboxOriginChanges.clear();
		this.workspaceFileSizes.clear();
		this.workspacePreloads.clear();
		this.workspacePreload = null;
	}

	async resetRuntime(): Promise<void> {
		this.workspaceMountSynced = false;
		this.resetWorkspaceSyncState();
		try {
			await this.request("runtime.reset", undefined);
		} catch (error) {
			logWarn("Sandbox runtime reset request failed", error);
		}
	}

	async executeCode(
		request: SandboxExecutionRequest,
	): Promise<SandboxExecutionResult> {
		return this.executeWithLazyDocumentsSupport("runtime.executeCode", request);
	}

	async health(): Promise<SandboxOperationResultMap["health"]> {
		return this.request("health", undefined);
	}

	async runFile(request: SandboxRunFileRequest): Promise<SandboxRunFileResult> {
		return this.executeWithLazyDocumentsSupport("runtime.runFile", {
			...request,
			path: this.normalizeVirtualPath(request.path),
		});
	}

	async executeCommand(
		request: SandboxExecuteCommandRequest,
	): Promise<SandboxCommandResult> {
		if (usesHostCommand(request.command)) {
			return runHostCommandLine(
				{
					...request,
					cwd: request.cwd
						? this.toWorkspaceCanonicalPath(
								this.normalizeVirtualPath(request.cwd),
							)
						: "/",
				},
				{
					files: await this.getHostFiles(),
					// A curl, git or py line may run while a server does.
					runShell: (command, cwd) =>
						this.executeShellCommand({
							...request,
							command,
							cwd,
							allowAlongside: true,
						}),
					runShellWithInput: (command, cwd, input) =>
						this.executeShellCommandWithInput(request, command, cwd, input),
					http: createCurlHttp({
						servers: async () =>
							(await this.listServers()).servers.map((server) => server.port),
						relay: (payload) => this.handleSwRequestWithRetry(payload),
						fetch: (input, init) => fetch(input, init),
					}),
					runPython: (payload) =>
						this.request(
							"python.run",
							payload,
							(payload.timeoutMs ?? 60_000) + COMMAND_REQUEST_TIMEOUT_BUFFER_MS,
						),
					filesChanged: () => {
						// The shell's copy of the files is stale now: remount it on the
						// next command, and tell the Files views.
						this.workspaceMountSynced = false;
						documentFileSystemService.notifyExternalChange(null);
					},
				},
			);
		}
		return this.executeShellCommand(request);
	}

	/**
	 * Loaded on the first git or py command: the host files open ZenFS, which
	 * importing this service must not do.
	 */
	private async getHostFiles(): Promise<HostFiles> {
		if (!this.hostFiles) {
			const { createHostFiles } = await import("./host-commands/host-files");
			this.hostFiles = createHostFiles();
		}
		return this.hostFiles;
	}

	/**
	 * Runs a shell command with `input` on its stdin, the way a pipe from a
	 * host command feeds it: the input waits in a file only the sandbox has.
	 */
	private async executeShellCommandWithInput(
		request: SandboxExecuteCommandRequest,
		command: string,
		cwd: string,
		input: string,
	): Promise<SandboxCommandResult> {
		const dir = "/node_modules/.memorall-pipes";
		const path = `${dir}/${crypto.randomUUID()}`;
		await this.request("fs.mkdir", { path: dir, recursive: true });
		await this.request("fs.writeFile", { path, content: input });
		try {
			return await this.executeShellCommand({
				...request,
				command: `cat '${path}' | ${command}`,
				cwd,
				allowAlongside: true,
			});
		} finally {
			await this.request("fs.unlink", { path }).catch(() => undefined);
		}
	}

	private async executeShellCommand(
		request: SandboxExecuteCommandRequest,
	): Promise<SandboxCommandResult> {
		const preparedRequest = await this.prepareCommandExecution(request);
		const result = await this.request(
			"runtime.executeCommand",
			preparedRequest,
			this.resolveCommandRequestTimeout(preparedRequest.waitTimeoutMs),
		);
		await this.flushWorkspaceWrites().catch((error) =>
			logWarn("Failed to flush workspace writes after command execution", {
				error,
			}),
		);
		return result;
	}

	async listenCommand(
		request: SandboxListenCommandRequest,
	): Promise<SandboxCommandResult> {
		const result = await this.request(
			"runtime.listenCommand",
			request,
			this.resolveCommandRequestTimeout(request.waitTimeoutMs),
		);
		await this.flushWorkspaceWrites().catch((error) =>
			logWarn("Failed to flush workspace writes after command listen", {
				error,
			}),
		);
		return result;
	}

	async sendCommandInput(
		request: SandboxSendCommandInputRequest,
	): Promise<{ commandId: string; sent: true }> {
		return this.request("runtime.sendCommandInput", request);
	}

	async stopCommand(
		request: SandboxStopCommandRequest,
	): Promise<{ commandId: string; stopped: true }> {
		const result = await this.request("runtime.stopCommand", request);
		await this.flushWorkspaceWrites().catch((error) =>
			logWarn("Failed to flush workspace writes after stopping command", {
				error,
			}),
		);
		return result;
	}

	async listCommands(): Promise<SandboxListCommandsResult> {
		return this.request("runtime.listCommands", undefined);
	}

	async createRepl(): Promise<SandboxOperationResultMap["runtime.createRepl"]> {
		return this.request("runtime.createRepl", undefined);
	}

	async replEval(
		request: SandboxOperationPayloadMap["runtime.replEval"],
	): Promise<SandboxExecutionResult> {
		return this.request("runtime.replEval", request);
	}

	async getLogs(
		request: SandboxGetLogsRequest = {},
	): Promise<SandboxGetLogsResult> {
		return this.request("runtime.getLogs", request);
	}

	async clearLogs(): Promise<{ cleared: true }> {
		return this.request("runtime.clearLogs", undefined);
	}

	async fetchResource(
		request: SandboxNetworkFetchRequest,
	): Promise<SandboxNetworkFetchResult> {
		return this.request("network.fetch", request);
	}

	async writeFile(
		request: SandboxFsWriteFileRequest,
	): Promise<{ path: string }> {
		const normalizedPath = this.normalizeVirtualPath(request.path);
		const workspacePath = this.toWorkspaceCanonicalPath(normalizedPath);
		await this.syncWorkspaceMount();
		return this.request("fs.writeFile", {
			...request,
			path: workspacePath,
		});
	}

	async readFile(
		request: SandboxFsReadFileRequest,
	): Promise<SandboxFsReadFileResult> {
		const normalizedPath = this.normalizeVirtualPath(request.path);
		const workspacePath = this.toWorkspaceCanonicalPath(normalizedPath);
		await this.syncWorkspaceMount();
		const bytes = await documentFileSystemService.readFile(workspacePath);
		const content = sandboxFileContent(bytes);
		await this.request("fs.materializeWorkspaceFile", {
			path: workspacePath,
			content,
		});
		return this.request("fs.readFile", { path: workspacePath });
	}

	async mkdir(request: SandboxFsMkdirRequest): Promise<{ path: string }> {
		const normalizedPath = this.normalizeVirtualPath(request.path);
		const workspacePath = this.toWorkspaceCanonicalPath(normalizedPath);
		await this.syncWorkspaceMount();
		return this.request("fs.mkdir", { ...request, path: workspacePath });
	}

	async readdir(
		request: SandboxFsReaddirRequest,
	): Promise<SandboxFsReaddirResult> {
		const normalizedPath = this.normalizeVirtualPath(request.path);
		const workspacePath = this.toWorkspaceCanonicalPath(normalizedPath);
		await this.syncWorkspaceMount();
		return this.request("fs.readdir", { path: workspacePath });
	}

	async unlink(request: SandboxFsUnlinkRequest): Promise<{ path: string }> {
		const normalizedPath = this.normalizeVirtualPath(request.path);
		const workspacePath = this.toWorkspaceCanonicalPath(normalizedPath);
		await this.syncWorkspaceMount();
		return this.request("fs.unlink", { ...request, path: workspacePath });
	}

	async rename(
		request: SandboxFsRenameRequest,
	): Promise<{ oldPath: string; newPath: string }> {
		const oldPath = this.toWorkspaceCanonicalPath(
			this.normalizeVirtualPath(request.oldPath),
		);
		const newPath = this.toWorkspaceCanonicalPath(
			this.normalizeVirtualPath(request.newPath),
		);
		await this.syncWorkspaceMount();
		return this.request("fs.rename", { oldPath, newPath });
	}

	async exists(
		request: SandboxFsExistsRequest,
	): Promise<SandboxFsExistsResult> {
		const normalizedPath = this.normalizeVirtualPath(request.path);
		const workspacePath = this.toWorkspaceCanonicalPath(normalizedPath);
		await this.syncWorkspaceMount();
		return this.request("fs.exists", { path: workspacePath });
	}

	private isDocumentsPath(path: string): boolean {
		return isDocumentsSandboxPath(path);
	}

	private toDocumentsLogicalPath(normalizedPath: string): string | null {
		return toDocumentsLogicalPath(normalizedPath);
	}

	private normalizeVirtualPath(inputPath: string): string {
		const raw = inputPath.trim().replace(/\\/g, "/");
		if (!raw) return "/";
		const candidate = raw.startsWith("/") ? raw : `/${raw}`;
		const parts = candidate.split("/").filter(Boolean);
		const resolved: string[] = [];
		for (const part of parts) {
			if (part === ".") continue;
			if (part === "..") {
				resolved.pop();
				continue;
			}
			resolved.push(part);
		}
		return resolved.length ? `/${resolved.join("/")}` : "/";
	}

	private async syncDocumentsMount(): Promise<void> {
		if (this.mountDocumentsSyncPromise) {
			return this.mountDocumentsSyncPromise;
		}

		this.mountDocumentsSyncPromise = (async () => {
			const { directories, files } =
				await documentFileSystemService.getSandboxMountSnapshot();
			await this.request("fs.mountDocuments", { directories, files });
		})().finally(() => {
			this.mountDocumentsSyncPromise = null;
		});

		return this.mountDocumentsSyncPromise;
	}

	private extractUnmaterializedMountedPath(
		errorMessage?: string,
	): string | null {
		if (!errorMessage) return null;
		const match = errorMessage.match(
			/Mounted file is not materialized in sandbox runtime: (\/[^\s]+)/,
		);
		return match?.[1] ?? null;
	}

	private isDocumentsMountNotLoadedError(errorMessage?: string): boolean {
		if (!errorMessage) return false;
		return errorMessage.includes(
			"Documents mount is not loaded in sandbox runtime",
		);
	}

	private async materializeMountedDocumentFile(
		sandboxPath: string,
	): Promise<boolean> {
		if (
			!this.isDocumentsPath(sandboxPath) ||
			sandboxPath === DOCUMENTS_SANDBOX_ROOT
		) {
			return false;
		}
		const logicalPath = toDocumentsLogicalPath(sandboxPath) ?? sandboxPath;
		try {
			const bytes = await documentFileSystemService.readFile(sandboxPath);
			const content = sandboxFileContent(bytes);
			await this.request("fs.materializeDocumentFile", {
				path: sandboxPath,
				content,
			});
			return true;
		} catch (error) {
			logWarn("Failed to lazily materialize mounted document file", {
				sandboxPath,
				logicalPath,
				error,
			});
			return false;
		}
	}

	// ── Workspace helpers ────────────────────────────────────────────────────

	private isWorkspacePath(path: string): boolean {
		return isWorkspacesSandboxPath(path);
	}

	private toWorkspaceCanonicalPath(path: string): string {
		return normalizeSandboxPath(path);
	}

	private async syncWorkspaceMount(): Promise<void> {
		if (this.workspaceMountSynced) {
			return;
		}
		if (this.mountWorkspaceSyncPromise) {
			return this.mountWorkspaceSyncPromise;
		}
		this.mountWorkspaceSyncPromise = this.enqueueWorkspaceSync(async () => {
			if (!this.workspaceMountSynced) await this.mountWorkspaceNow();
		}).finally(() => {
			this.mountWorkspaceSyncPromise = null;
		});
		return this.mountWorkspaceSyncPromise;
	}

	/**
	 * Mount the whole filesystem afresh, then start copying file contents in.
	 * Runs inside the workspace sync chain.
	 */
	private async mountWorkspaceNow(): Promise<void> {
		// Mounting clears the runtime's queue of unsaved writes: save them first.
		await this.drainWorkspaceWrites();
		const { directories, files, fileSizes } =
			await documentFileSystemService.getSandboxWorkspaceMountSnapshot();
		await this.request("fs.mountWorkspace", { directories, files });
		this.workspaceMountSynced = true;
		this.rememberWorkspaceFileSizes(fileSizes);
		this.workspacePreloads.clear();
		// Not awaited: it can take a while on a large filesystem, and commands
		// wait for it themselves before they run.
		this.workspacePreload = this.preloadWorkspaceFiles("/", false).catch(
			(error) => logWarn("Failed to preload workspace files", { error }),
		);
	}

	private async materializeMountedWorkspaceFile(
		sandboxPath: string,
	): Promise<boolean> {
		try {
			const bytes = await documentFileSystemService.readFile(sandboxPath);
			const content = sandboxFileContent(bytes);
			await this.request("fs.materializeWorkspaceFile", {
				path: sandboxPath,
				content,
			});
			return true;
		} catch (error) {
			logWarn("Failed to lazily materialize workspace file", {
				sandboxPath,
				error,
			});
			return false;
		}
	}

	private encodeBytesBase64(bytes: Uint8Array): string {
		if (bytes.byteLength === 0) return "";
		let binary = "";
		const chunkSize = 8192;
		for (let i = 0; i < bytes.byteLength; i += chunkSize) {
			binary += String.fromCharCode(
				...bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)),
			);
		}
		return btoa(binary);
	}

	private getDirectWorkspaceContentType(sandboxPath: string): string | null {
		const lowerPath = sandboxPath.toLowerCase();
		const extension = Object.keys(DIRECT_WORKSPACE_CONTENT_TYPES).find((ext) =>
			lowerPath.endsWith(ext),
		);
		return extension ? DIRECT_WORKSPACE_CONTENT_TYPES[extension] : null;
	}

	private async tryServeDirectWorkspaceFile(params: {
		method: string;
		missingPath: string;
	}): Promise<SandboxHandleSwRequestResult | null> {
		const method = params.method.toUpperCase();
		if (method !== "GET" && method !== "HEAD") {
			return null;
		}

		const sandboxPath = this.toWorkspaceCanonicalPath(params.missingPath);
		const contentType = this.getDirectWorkspaceContentType(sandboxPath);
		if (!contentType) {
			return null;
		}

		try {
			const bytes = await documentFileSystemService.readFile(sandboxPath);
			logInfo(
				`[SW relay] serving ${sandboxPath} directly from workspace storage after materialization miss`,
			);
			return {
				statusCode: 200,
				statusMessage: "OK",
				headers: {
					"Content-Type": contentType,
					"Content-Length": String(bytes.byteLength),
					"Cache-Control": "no-cache",
					"X-Workspace-Direct-Fallback": "true",
				},
				bodyBase64: method === "HEAD" ? "" : this.encodeBytesBase64(bytes),
			};
		} catch (error) {
			logWarn("[SW relay] direct workspace file fallback failed", {
				sandboxPath,
				error,
			});
			return null;
		}
	}

	private extractUnmaterializedWorkspacePath(
		errorMessage?: string,
	): string | null {
		if (!errorMessage) return null;
		const match = errorMessage.match(
			/(?:Workspace file not materialized|Mounted file is not materialized in sandbox runtime): (\/[^\s]+)/,
		);
		return match?.[1] ? this.toWorkspaceCanonicalPath(match[1]) : null;
	}

	private isWorkspaceMountNotLoadedError(errorMessage?: string): boolean {
		if (!errorMessage) return false;
		return errorMessage.includes(
			"Workspace mount is not loaded in sandbox runtime",
		);
	}

	/**
	 * Drain pending workspace writes/deletes/renames and persist to ZenFS.
	 * Called after every command, and while one runs whenever the runtime says
	 * writes are waiting.
	 */
	private flushWorkspaceWrites(): Promise<void> {
		return this.enqueueWorkspaceSync(() => this.drainWorkspaceWrites());
	}

	private async drainWorkspaceWrites(): Promise<void> {
		const { ops } = await this.request("fs.flushWorkspaceWrites", undefined);
		for (const op of ops ?? []) {
			this.rememberSandboxChange(op);
			try {
				if (op.op === "write") {
					await documentFileSystemService.writeFile(op.path, op.content);
				} else if (op.op === "mkdir") {
					await documentFileSystemService.mkdir(op.path);
				} else if (op.op === "delete") {
					await documentFileSystemService.deleteFile(op.path);
				} else if (op.op === "rename") {
					// renamePath, not rename: a sandbox `mv` can change folders.
					await documentFileSystemService.renamePath(op.oldPath, op.newPath);
				}
			} catch (error) {
				logWarn("Failed to flush workspace op", { op, error });
			}
		}
	}

	// ── End Workspace helpers ─────────────────────────────────────────────────

	private async executeWithLazyDocumentsSupport<
		T extends "runtime.executeCode" | "runtime.runFile",
	>(
		operation: T,
		payload: SandboxOperationPayloadMap[T],
	): Promise<SandboxOperationResultMap[T]> {
		const maxRetries = 5;
		const retriedPaths = new Set<string>();
		let hasMountedDocuments = false;
		let hasMountedWorkspace = false;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			const result = await this.request(operation, payload);
			if (result.status !== "error") {
				await this.flushWorkspaceWrites().catch((err) =>
					logWarn("Failed to flush workspace writes after execution", { err }),
				);
				return result;
			}

			if (this.isDocumentsMountNotLoadedError(result.error)) {
				if (hasMountedDocuments) return result;
				await this.syncDocumentsMount();
				hasMountedDocuments = true;
				continue;
			}

			if (this.isWorkspaceMountNotLoadedError(result.error)) {
				if (hasMountedWorkspace) return result;
				await this.syncWorkspaceMount();
				hasMountedWorkspace = true;
				continue;
			}

			const missingDocPath = this.extractUnmaterializedMountedPath(
				result.error,
			);
			if (missingDocPath && !retriedPaths.has(missingDocPath)) {
				retriedPaths.add(missingDocPath);
				const materialized =
					await this.materializeMountedDocumentFile(missingDocPath);
				if (materialized) continue;
				return result;
			}

			const missingWsPath = this.extractUnmaterializedWorkspacePath(
				result.error,
			);
			if (missingWsPath && !retriedPaths.has(missingWsPath)) {
				retriedPaths.add(missingWsPath);
				const materialized = await this.materializeMountedWorkspaceFile(
					this.toWorkspaceCanonicalPath(missingWsPath),
				);
				if (materialized) continue;
				return result;
			}

			return result;
		}

		return this.request(operation, payload);
	}

	async installPackage(
		request: SandboxNpmInstallRequest,
	): Promise<SandboxNpmInstallResult> {
		await this.syncWorkspaceMount();
		const result = await this.request("npm.install", request);
		await this.flushWorkspaceWrites();
		return result;
	}

	async installFromPackageJson(
		request: SandboxNpmInstallFromPackageJsonRequest = {},
	): Promise<SandboxNpmInstallResult> {
		await this.syncWorkspaceMount();
		const result = await this.request("npm.installFromPackageJson", request);
		await this.flushWorkspaceWrites();
		return result;
	}

	async listInstalledPackages(): Promise<SandboxNpmListResult> {
		await this.syncWorkspaceMount();
		return this.request("npm.list", undefined);
	}

	/**
	 * Resolve a relative renderUrl (e.g. "/sandbox/__virtual__/3000/") to a
	 * fully-qualified chrome-extension URL so popup iframes can navigate to it
	 * via the almostnode service worker.
	 */
	private resolveRenderUrl(rawUrl: string): string {
		if (rawUrl.startsWith("/")) {
			const base = this.assetBaseUrl().replace(/\/$/, "");
			return base + rawUrl;
		}
		return rawUrl;
	}

	private buildVirtualServerUrl(port: number, path: string): string {
		return (
			this.assetBaseUrl() +
			`__virtual__/${port}${path.startsWith("/") ? path : `/${path}`}`
		);
	}

	private assetBaseUrl(): string {
		const sentinel = "__memorall_asset_root__";
		return platform.assets.url(sentinel).slice(0, -sentinel.length);
	}

	private async buildRendererImportMap(
		_port: number,
	): Promise<Record<string, string>> {
		// Manifest V3 forbids downloading executable modules at runtime. Package
		// installation stays isolated in the local sandbox, but preview rendering
		// never maps dependencies to a remote module CDN.
		return {};
	}

	private async buildRendererPreviewConfig(
		port: number,
		requestPath: string | undefined,
	): Promise<RendererPreviewConfig> {
		const path = requestPath ?? "/";
		const virtualUrl = this.buildVirtualServerUrl(port, path);
		const importMap = await this.buildRendererImportMap(port);
		const rendererUrl =
			platform.assets.url("sandbox/pages/renderer.html") +
			`?port=${port}&path=${encodeURIComponent(path)}&importMap=${encodeURIComponent(JSON.stringify(importMap))}`;

		return {
			path,
			virtualUrl,
			rendererUrl,
			importMap,
		};
	}

	private resolveServerEntryPath(
		rootDir: string | undefined,
		entryPath: string | undefined,
	): string | undefined {
		if (!entryPath) {
			return undefined;
		}

		const normalizedEntry = this.normalizeVirtualPath(entryPath);
		if (entryPath.startsWith("/")) {
			return normalizedEntry;
		}

		const normalizedRoot = rootDir
			? this.normalizeVirtualPath(rootDir)
			: undefined;
		if (!normalizedRoot || normalizedRoot === "/") {
			return normalizedEntry;
		}

		const relativeEntry = normalizedEntry.replace(/^\/+/, "");
		return this.normalizeVirtualPath(`${normalizedRoot}/${relativeEntry}`);
	}

	async startServer(
		request: SandboxStartServerRequest,
	): Promise<SandboxStartServerResult> {
		const resolvedEntryPath = this.resolveServerEntryPath(
			request.rootDir,
			request.entryPath,
		);

		// The server reads its files synchronously, as a command does: load the
		// project folder, dependencies included, before it starts.
		await Promise.all([this.syncDocumentsMount(), this.syncWorkspaceMount()]);
		await this.workspacePreload;
		const serverDir = request.rootDir
			? this.toWorkspaceCanonicalPath(request.rootDir)
			: resolvedEntryPath
				? this.toWorkspaceCanonicalPath(resolvedEntryPath).replace(
						/\/[^/]*$/,
						"",
					)
				: "";
		if (serverDir && serverDir !== "/") {
			await this.preloadWorkspaceFiles(serverDir, true).catch((error) =>
				logWarn("Failed to preload the server's folder", { serverDir, error }),
			);
		}
		if (resolvedEntryPath) {
			// Loaded even when the runtime has not listed it yet (just written).
			await this.materializeMountedWorkspaceFile(
				this.toWorkspaceCanonicalPath(resolvedEntryPath),
			);
		}

		// Allow extra time when a template will be scaffolded + npm-installed.
		const timeoutMs = request.template ? 300_000 : 60_000;
		const result = await this.request(
			"server.start",
			{
				...request,
				rootDir: request.rootDir
					? this.toWorkspaceCanonicalPath(request.rootDir)
					: request.rootDir,
				entryPath: resolvedEntryPath
					? this.toWorkspaceCanonicalPath(resolvedEntryPath)
					: resolvedEntryPath,
			},
			timeoutMs,
		);
		// Flush any sync writes (scaffolded template files) that queued via
		// pendingWorkspaceOps but weren't persisted by the async bridge yet.
		await this.flushWorkspaceWrites().catch((err) =>
			logWarn("Failed to flush workspace writes after server.start", { err }),
		);
		return { ...result, renderUrl: this.resolveRenderUrl(result.renderUrl) };
	}

	async stopServer(
		request: SandboxStopServerRequest,
	): Promise<{ port: number }> {
		return this.request("server.stop", request);
	}

	async listServers(): Promise<SandboxListServersResult> {
		return this.request("server.list", undefined);
	}

	async requestServer(
		request: SandboxServerRequest,
	): Promise<SandboxServerRequestResult> {
		if (request.useIframe) {
			return this.renderViaIframe(request);
		}
		return this.request(
			"server.request",
			request,
			request.timeoutMs ?? 120_000,
		);
	}

	/**
	 * Render a virtual server page and return the fully rendered HTML.
	 *
	 * We load /sandbox/pages/renderer.html (a normal extension page within the SW's
	 * /sandbox/ scope). The renderer fetches /__virtual__/<port>/* — the SW
	 * intercepts those fetches and relays them to the sandbox via
	 * server.handleSwRequest → handleRequest. Once React mounts, the renderer
	 * sends a postMessage back with the final outerHTML.
	 */
	private async renderViaIframe(
		request: SandboxServerRequest,
	): Promise<SandboxServerRequestResult> {
		// The SW is killed by Chrome when idle and restarts with mainPort=null.
		// Re-send the relay port before the renderer iframe makes any fetches.
		const sw =
			this.swInstance ??
			navigator.serviceWorker.controller ??
			(await navigator.serviceWorker.ready).active;
		if (sw) {
			await this.initSwRelay(sw).catch((error) =>
				logWarn("[SW] Falling back to the extension job bridge", error),
			);
		}

		const previewConfig = await this.buildRendererPreviewConfig(
			request.port,
			request.path,
		);
		const { virtualUrl, rendererUrl, importMap } = previewConfig;
		const timeoutMs = request.timeoutMs ?? 120_000;
		// Unique ID to match the postMessage from renderer-utils.js.
		// Passed via iframe.name (survives document.write inside the renderer).
		const renderId = Math.random().toString(36).slice(2, 10);

		if (Object.keys(importMap).length > 0) {
			sw?.postMessage({
				type: "set-import-map",
				data: { port: request.port, importMap },
			});
		}

		return new Promise<SandboxServerRequestResult>((resolve) => {
			const iframe = document.createElement("iframe");
			iframe.style.cssText =
				"position:fixed;top:-9999px;left:-9999px;width:1280px;height:800px;opacity:0;pointer-events:none;";
			// window.name in the renderer survives document.write; used by
			// renderer-utils.js to include the renderId in its postMessage.
			iframe.name = renderId;

			let settled = false;
			const settle = (html: string, keepIframe = false) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				window.removeEventListener("message", messageHandler);
				if (!keepIframe) iframe.remove();
				resolve({
					port: request.port,
					url: virtualUrl,
					status: 200,
					ok: true,
					contentType: "text/html",
					responseType: "html",
					headers: {},
					body: html,
				});
			};

			// renderer-utils.js postMessages once React has mounted.
			// renderer.js also relays SW fetch requests through this handler.
			const messageHandler = (event: MessageEvent) => {
				if (
					event.data?.type === "virtual-renderer-ready" &&
					event.data.renderId === renderId
				) {
					settle((event.data.html as string) ?? "");
					return;
				}

				if (
					event.data?.type === "sw-relay-request" &&
					event.source === iframe.contentWindow
				) {
					const {
						id,
						portNum,
						method,
						url: swUrl,
						headers,
						body,
					} = event.data as {
						id: number;
						portNum: number;
						method: string;
						url: string;
						headers: Record<string, string>;
						body: ArrayBuffer | null;
					};
					void this.handleSwRequestWithRetry({
						id,
						port: portNum,
						method,
						path: swUrl,
						headers: headers ?? {},
						body: body ?? null,
					})
						.then((result) => {
							iframe.contentWindow?.postMessage(
								{ type: "sw-relay-response", id, data: result },
								"*",
							);
						})
						.catch((err: unknown) => {
							iframe.contentWindow?.postMessage(
								{
									type: "sw-relay-response",
									id,
									error: err instanceof Error ? err.message : String(err),
								},
								"*",
							);
						});
				}
			};
			window.addEventListener("message", messageHandler);

			const timeoutId = window.setTimeout(() => {
				logWarn(
					"[renderViaIframe] Timeout — keeping iframe alive for inspection. Check devtools for the hidden iframe.",
				);
				// DEBUG: pass true so settle() does NOT remove the iframe.
				// Revert: change settle("", true) back to settle("") when done debugging.
				settle("", true);
			}, timeoutMs);

			document.body.appendChild(iframe);
			iframe.src = rendererUrl;
		});
	}

	async getServerRenderUrl(
		request: SandboxServerRenderUrlRequest,
	): Promise<SandboxServerRenderUrlResult> {
		const serviceWorker = navigator.serviceWorker;
		const sw = serviceWorker
			? (this.swInstance ??
				serviceWorker.controller ??
				(await serviceWorker.ready).active)
			: null;
		if (sw) {
			await this.initSwRelay(sw).catch((error) =>
				logWarn("[SW] Render URL will use the extension job bridge", error),
			);
		}
		const previewConfig = await this.buildRendererPreviewConfig(
			request.port,
			request.path,
		);
		return { port: request.port, url: previewConfig.rendererUrl };
	}

	async getSnapshot(): Promise<{ snapshot: unknown }> {
		return this.request("snapshot.get", undefined);
	}

	async restoreSnapshot(
		request: SandboxRestoreSnapshotRequest,
	): Promise<{ restored: true }> {
		const result = await this.request("snapshot.restore", request, 60_000);
		this.workspaceMountSynced = true;
		await this.flushWorkspaceWrites();
		return result;
	}
}

export { SandboxContainerServiceMain as SandboxContainerService };

export const sandboxContainerMainService =
	SandboxContainerServiceMain.getInstance();

export const ensureSandboxContainerMainReady = async (): Promise<void> => {
	try {
		await sandboxContainerMainService.initialize();
	} catch (error) {
		logError("Failed to initialize SandboxContainerServiceMain", error);
		throw error;
	}
};
