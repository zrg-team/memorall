import type { BaseEmbedding } from "../interfaces/base-embedding";
import type { MultimodalEmbeddingInput } from "../interfaces/multimodal-embedding";
import { LLM_RUNNER_URLS } from "@/config/llm-runner";
import { waitForDOMReady } from "@/utils/dom";
import { logError, logInfo, logWarn } from "@/utils/logger";

interface BaseMessage {
	messageId: string;
}

interface OutgoingMessage extends BaseMessage {
	type: "init" | "embeddings" | "models" | "embed-content";
	payload?: unknown;
}

interface IncomingMessage extends BaseMessage {
	type: "ready" | "progress" | "complete" | "error";
	payload?: unknown;
}

interface ErrorResponse {
	error: {
		message: string;
		type: string;
		code: string | null;
	};
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
};

type PendingMeta = {
	startedAt: number;
	lastProgressAt: number;
	idleTimeout?: ReturnType<typeof setTimeout>;
	maxTimeout?: ReturnType<typeof setTimeout>;
};

export interface WorkerEmbeddingOptions {
	modelName?: string;
	runnerUrl?: string;
	device?: "wasm" | "webgpu" | "auto";
	revision?: string;
	/**
	 * Remove the runner iframe after this long without a request (0 keeps it).
	 * The model and ONNX Runtime's arena live in the iframe's wasm memory —
	 * hundreds of MB — and a wasm memory never shrinks, so removing the iframe
	 * is the only way to give it back. The next request loads the model again,
	 * from the browser's cache.
	 */
	idleReleaseMs?: number;
}

export const DEFAULT_EMBEDDING_IDLE_RELEASE_MS = 3 * 60_000;
/** After a failed load, report not ready for this long so callers fall back. */
const FAILED_LOAD_COOLDOWN_MS = 60_000;

export class WorkerEmbedding implements BaseEmbedding {
	name: string;
	dimensions: number = 0;
	private iframe: HTMLIFrameElement | null = null;
	/** The runner iframe exists and has the model loaded. */
	private loaded = false;
	private loading: Promise<void> | null = null;
	private activeRequests = 0;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private lastLoadFailedAt: number | null = null;
	/** Removed from its service: it never loads again. */
	private removed = false;
	private pending = new Map<string, PendingRequest>();
	private pendingMeta = new Map<string, PendingMeta>();
	private url: string;
	private modelName: string;
	private device: NonNullable<WorkerEmbeddingOptions["device"]>;
	private readonly idleReleaseMs: number;

	constructor(options: WorkerEmbeddingOptions = {}) {
		this.modelName = options.modelName || "nomic-ai/nomic-embed-text-v1.5";
		this.name = this.modelName;
		this.device = options.device || "wasm";
		this.idleReleaseMs =
			options.idleReleaseMs ?? DEFAULT_EMBEDDING_IDLE_RELEASE_MS;
		const baseUrl = options.runnerUrl || LLM_RUNNER_URLS?.embedding;
		const url = new URL(
			baseUrl,
			typeof location !== "undefined" ? location.href : undefined,
		);
		url.searchParams.set("mode", "embedding");
		url.searchParams.set("model", this.modelName);
		url.searchParams.set("device", this.device);
		if (options.revision) url.searchParams.set("revision", options.revision);
		this.url = url.toString();
	}

	/** Load the model now. Requests load it on their own when needed. */
	async initialize(): Promise<void> {
		if (this.removed) throw new Error("Embedding was removed");
		if (this.loaded) return;
		this.loading ??= this.load().finally(() => {
			this.loading = null;
		});
		await this.loading;
		this.scheduleIdleRelease();
	}

	private async load(): Promise<void> {
		try {
			logInfo(
				`🔤 WorkerEmbedding initialize (model=${this.modelName}, device=${this.device})`,
			);
			logInfo(`🔤 WorkerEmbedding runner url: ${this.url}`);
			await waitForDOMReady();
			this.iframe = document.createElement("iframe");
			this.iframe.src = this.url;
			this.iframe.style.display = "none";
			document.body.appendChild(this.iframe);
			logInfo("🔤 WorkerEmbedding runner iframe appended");

			window.addEventListener("message", this.onMessage);

			await new Promise<void>((resolve, reject) => {
				logInfo("🔤 WorkerEmbedding waiting for RUNNER_READY...");
				const timeout = setTimeout(() => {
					window.removeEventListener("message", handler);
					reject(new Error("Embedding runner did not become ready"));
				}, 30_000);
				const handler = (e: MessageEvent<IncomingMessage>) => {
					if (e.data?.messageId === "RUNNER_READY") {
						const isFromRunner = e.source === this.iframe?.contentWindow;
						logInfo(
							`🔤 WorkerEmbedding received RUNNER_READY (origin=${e.origin}, fromRunner=${isFromRunner})`,
						);
						if (isFromRunner) {
							clearTimeout(timeout);
							window.removeEventListener("message", handler);
							resolve();
						}
					}
				};
				window.addEventListener("message", handler);
			});

			logInfo("🔤 WorkerEmbedding sending init to runner...");
			const initStartTime = Date.now();
			await this.send(
				"init",
				{ modelName: this.modelName },
				{ timeoutMs: 600_000 },
			);
			const initDuration = Date.now() - initStartTime;
			logInfo(
				`🔤 WorkerEmbedding init completed (took ${Math.round(initDuration / 1000)}s)`,
			);

			// Get model info to set dimensions (embedding models typically have known dimensions)
			this.dimensions = 768; // Default for most embedding models, will be updated if needed

			this.loaded = true;
			this.lastLoadFailedAt = null;
		} catch (e) {
			// Ensure we don't leave a broken iframe/listeners around which can cause
			// subsequent initializations to hang.
			this.releaseRunner();
			this.lastLoadFailedAt = Date.now();
			throw e;
		}
	}

	/**
	 * Whether requests can be served. The model loads on first use and is
	 * released when idle, so this holds while it is unloaded too; only a load
	 * that just failed makes it false, so callers fall back to working without
	 * vectors instead of waiting on a model that cannot load.
	 */
	isReady(): boolean {
		if (this.removed) return false;
		return (
			this.lastLoadFailedAt === null ||
			Date.now() - this.lastLoadFailedAt >= FAILED_LOAD_COOLDOWN_MS
		);
	}

	/** Whether the model is in memory right now. */
	isLoaded(): boolean {
		return this.loaded;
	}

	async textToVector(text: string): Promise<number[]> {
		return this.withRunner(async () => {
			const response = (await this.send("embeddings", { input: text })) as {
				data: Array<{ embedding: number[] }>;
			};
			return response.data[0].embedding;
		});
	}

	/** Native text, image, audio or sampled-video input; requires a multimodal model. */
	async contentToVector(input: MultimodalEmbeddingInput): Promise<number[]> {
		return this.withRunner(async () => {
			const response = (await this.send(
				"embed-content",
				{ input, model: this.modelName },
				{ timeoutMs: 600_000 },
			)) as { embedding: number[] };
			return response.embedding;
		});
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		return this.withRunner(async () => {
			const response = (await this.send("embeddings", { input: texts })) as {
				data: Array<{ embedding: number[] }>;
			};
			return response.data.map((item) => item.embedding);
		});
	}

	/** Run a request with the model loaded, holding off the idle release. */
	private async withRunner<T>(request: () => Promise<T>): Promise<T> {
		this.activeRequests += 1;
		this.cancelIdleRelease();
		try {
			await this.initialize();
			return await request();
		} finally {
			this.activeRequests -= 1;
			this.scheduleIdleRelease();
		}
	}

	private cancelIdleRelease(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
	}

	private scheduleIdleRelease(): void {
		this.cancelIdleRelease();
		if (
			this.removed ||
			!this.loaded ||
			this.activeRequests > 0 ||
			this.idleReleaseMs <= 0
		) {
			return;
		}
		this.idleTimer = setTimeout(() => {
			this.idleTimer = null;
			if (this.activeRequests > 0 || this.loading || !this.loaded) return;
			logInfo(
				`🔤 WorkerEmbedding releasing idle runner (model=${this.modelName})`,
			);
			this.releaseRunner();
		}, this.idleReleaseMs);
	}

	getInfo(): {
		name: string;
		dimensions: number;
		type: "local" | "openai" | "custom";
	} {
		return {
			name: this.name,
			dimensions: this.dimensions,
			type: "custom",
		};
	}

	/** Remove for good: called when the embedding is removed from its service. */
	destroy(): void {
		this.removed = true;
		this.cancelIdleRelease();
		this.releaseRunner();
	}

	/** Remove the runner iframe and with it the model; the next request loads it again. */
	private releaseRunner(): void {
		this.iframe?.remove();
		this.iframe = null;
		window.removeEventListener("message", this.onMessage);
		this.pendingMeta.forEach(({ idleTimeout, maxTimeout }) => {
			if (idleTimeout) clearTimeout(idleTimeout);
			if (maxTimeout) clearTimeout(maxTimeout);
		});
		this.pendingMeta.clear();
		this.pending.forEach(({ reject }) =>
			reject(new Error("Service destroyed")),
		);
		this.pending.clear();
		this.loaded = false;
	}

	private onMessage = (ev: MessageEvent<IncomingMessage>) => {
		const { messageId, type, payload } = ev.data || {};

		// CRITICAL: Only process messages from our own iframe to prevent cross-contamination
		const fromRunner = ev.source === this.iframe?.contentWindow;
		if (!fromRunner) {
			// Silently ignore messages from other iframes
			return;
		}

		if (!messageId) return;
		if (messageId === "RUNNER_READY") return; // Already handled during initialization

		const pendingRequest = this.pending.get(messageId);
		if (!pendingRequest) {
			logWarn(
				`🔤 WorkerEmbedding received message with no pending request (messageId=${messageId}, type=${type}, origin=${ev.origin})`,
			);
			return;
		}

		if (type === "progress") {
			const meta = this.pendingMeta.get(messageId);
			if (meta) meta.lastProgressAt = Date.now();
			return;
		}

		this.pending.delete(messageId);
		const meta = this.pendingMeta.get(messageId);
		if (meta?.idleTimeout) clearTimeout(meta.idleTimeout);
		if (meta?.maxTimeout) clearTimeout(meta.maxTimeout);
		this.pendingMeta.delete(messageId);

		if (type === "complete") {
			pendingRequest.resolve(payload);
		} else if (type === "error") {
			const errorData = payload as ErrorResponse;
			const error = new Error(errorData.error?.message || "Unknown error");
			logError(
				`🔤 WorkerEmbedding runner error (messageId=${messageId}, origin=${ev.origin})`,
				error,
			);
			pendingRequest.reject(error);
		}
	};

	private send(
		type: OutgoingMessage["type"],
		payload?: unknown,
		options?: { timeoutMs?: number },
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const target = this.iframe?.contentWindow;
			if (!target)
				return reject(new Error("Embedding runner iframe not ready"));

			const id = Math.random().toString(36).slice(2);
			this.pending.set(id, { resolve, reject });

			// logInfo(
			// 	`🔤 WorkerEmbedding -> runner send (type=${type}, messageId=${id}, runnerOrigin=${this.iframe?.src})`,
			// );
			const startedAt = Date.now();

			// Setup timeout based on options (0 = no timeout)
			const timeoutMs = options?.timeoutMs ?? 60_000;
			if (timeoutMs > 0) {
				const lastProgressAt = startedAt;
				const idleTimeoutMs = timeoutMs;
				const maxTimeoutMs = timeoutMs;

				const fail = (reason: string) => {
					if (!this.pending.has(id)) return;
					this.pending.delete(id);
					const meta = this.pendingMeta.get(id);
					if (meta?.idleTimeout) clearTimeout(meta.idleTimeout);
					if (meta?.maxTimeout) clearTimeout(meta.maxTimeout);
					this.pendingMeta.delete(id);
					logWarn(
						`🔤 WorkerEmbedding request timeout (${reason}) (type=${type}, messageId=${id}, elapsedMs=${Date.now() - startedAt})`,
					);
					reject(new Error(`Embedding runner timed out (${type})`));
				};

				const scheduleIdleCheck = () => {
					const meta = this.pendingMeta.get(id);
					if (!meta) return;
					if (meta.idleTimeout) clearTimeout(meta.idleTimeout);
					meta.idleTimeout = setTimeout(() => {
						const m = this.pendingMeta.get(id);
						if (!m) return;
						const idleFor = Date.now() - m.lastProgressAt;
						if (idleFor >= idleTimeoutMs) {
							fail(`idle>${idleTimeoutMs}ms`);
							return;
						}
						scheduleIdleCheck();
					}, idleTimeoutMs);
				};

				this.pendingMeta.set(id, {
					startedAt,
					lastProgressAt,
				});
				scheduleIdleCheck();
				const meta = this.pendingMeta.get(id);
				if (meta) {
					meta.maxTimeout = setTimeout(
						() => fail(`max>${maxTimeoutMs}ms`),
						maxTimeoutMs,
					);
				}
			}

			this.pending.set(id, {
				resolve: (value) => {
					const meta = this.pendingMeta.get(id);
					if (meta?.idleTimeout) clearTimeout(meta.idleTimeout);
					if (meta?.maxTimeout) clearTimeout(meta.maxTimeout);
					this.pendingMeta.delete(id);
					// logInfo(
					// 	`🔤 WorkerEmbedding request completed (type=${type}, messageId=${id}, elapsedMs=${Date.now() - startedAt})`,
					// );
					resolve(value);
				},
				reject: (error) => {
					const meta = this.pendingMeta.get(id);
					if (meta?.idleTimeout) clearTimeout(meta.idleTimeout);
					if (meta?.maxTimeout) clearTimeout(meta.maxTimeout);
					this.pendingMeta.delete(id);
					reject(error);
				},
			});

			try {
				const message: OutgoingMessage = { messageId: id, type, payload };
				target.postMessage(message, "*");
			} catch (e) {
				this.pending.delete(id);
				const meta = this.pendingMeta.get(id);
				if (meta?.idleTimeout) clearTimeout(meta.idleTimeout);
				if (meta?.maxTimeout) clearTimeout(meta.maxTimeout);
				this.pendingMeta.delete(id);
				reject(e);
			}
		});
	}
}
