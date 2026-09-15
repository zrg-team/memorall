import { waitForDOMReady } from "@/utils/dom";
import type { ProgressEvent } from "../interfaces/base-llm";

interface RunnerMessage {
	messageId: string;
	type: string;
	payload?: unknown;
}

interface RunnerErrorPayload {
	error?: { message?: string; type?: string; code?: string | null };
}

export interface RunnerRequestOptions {
	onProgress?: (progress: ProgressEvent) => void;
	/** Every `stream_chunk` payload, in order. */
	onChunk?: (chunk: unknown) => void;
	signal?: AbortSignal;
	/** Buffers moved to the runner instead of copied. */
	transfer?: Transferable[];
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	options?: RunnerRequestOptions;
	cleanup?: () => void;
};

export class RunnerError extends Error {
	code?: string | null;
}

/**
 * The postMessage client every runner host shares.
 *
 * Opens the hidden runner iframe, waits for `RUNNER_READY`, and pairs each
 * request with its `progress` / `stream_chunk` / `stream_end` / `complete` /
 * `error` replies. Abort sends `abort` for the same message id. Only replies
 * from this client's own iframe are accepted: several runners share the
 * window's message channel.
 */
export class RunnerIframeClient {
	private iframe: HTMLIFrameElement | null = null;
	private ready = false;
	private starting: Promise<void> | null = null;
	private readonly pending = new Map<string, PendingRequest>();

	constructor(
		private readonly url: string,
		private readonly label: string,
		private readonly onAnyProgress?: (progress: ProgressEvent) => void,
	) {}

	isReady(): boolean {
		return this.ready;
	}

	initialize(): Promise<void> {
		if (this.ready) return Promise.resolve();
		if (!this.starting) {
			this.starting = this.start().finally(() => {
				this.starting = null;
			});
		}
		return this.starting;
	}

	private async start(): Promise<void> {
		try {
			await waitForDOMReady();
			const iframe = document.createElement("iframe");
			iframe.src = this.url;
			iframe.style.display = "none";
			iframe.dataset.memorallRunner = this.label;
			this.iframe = iframe;
			window.addEventListener("message", this.onMessage);

			const readyPromise = new Promise<void>((resolve) => {
				const handler = (event: MessageEvent<RunnerMessage>) => {
					if (
						event.data?.messageId === "RUNNER_READY" &&
						event.source === this.iframe?.contentWindow
					) {
						window.removeEventListener("message", handler);
						resolve();
					}
				};
				window.addEventListener("message", handler);
			});
			document.body.appendChild(iframe);
			await readyPromise;

			this.ready = true;
			await this.request("init");
		} catch (error) {
			this.destroy();
			throw error;
		}
	}

	async request(
		type: string,
		payload?: unknown,
		options?: RunnerRequestOptions,
	): Promise<unknown> {
		if (type !== "init") {
			await this.initialize();
		}
		const target = this.iframe?.contentWindow;
		if (!target) {
			throw new Error(`${this.label} runner is not available`);
		}

		const messageId = `${this.label}-${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 10)}`;

		return new Promise((resolve, reject) => {
			const entry: PendingRequest = { resolve, reject, options };
			const signal = options?.signal;
			if (signal) {
				if (signal.aborted) {
					reject(new DOMException("Operation aborted", "AbortError"));
					return;
				}
				const onAbort = () => {
					this.pending.delete(messageId);
					target.postMessage({ messageId, type: "abort" }, "*");
					reject(new DOMException("Operation aborted", "AbortError"));
				};
				signal.addEventListener("abort", onAbort, { once: true });
				entry.cleanup = () => signal.removeEventListener("abort", onAbort);
			}
			this.pending.set(messageId, entry);
			const message: RunnerMessage = { messageId, type, payload };
			target.postMessage(message, "*", options?.transfer ?? []);
		});
	}

	destroy(): void {
		this.iframe?.remove();
		this.iframe = null;
		this.ready = false;
		window.removeEventListener("message", this.onMessage);
		const error = new Error(`${this.label} runner destroyed`);
		for (const entry of this.pending.values()) {
			entry.cleanup?.();
			entry.reject(error);
		}
		this.pending.clear();
	}

	private settle(messageId: string): PendingRequest | undefined {
		const entry = this.pending.get(messageId);
		if (!entry) return undefined;
		this.pending.delete(messageId);
		entry.cleanup?.();
		return entry;
	}

	private readonly onMessage = (event: MessageEvent<RunnerMessage>) => {
		if (event.source !== this.iframe?.contentWindow) return;
		const { messageId, type, payload } = event.data || ({} as RunnerMessage);
		if (!messageId) return;
		const entry = this.pending.get(messageId);
		if (!entry) return;

		switch (type) {
			case "progress": {
				const progress = normalizeProgress(payload);
				entry.options?.onProgress?.(progress);
				this.onAnyProgress?.(progress);
				return;
			}
			case "stream_chunk":
				entry.options?.onChunk?.(payload);
				return;
			case "stream_end":
				this.settle(messageId)?.resolve(payload);
				return;
			case "complete":
				this.settle(messageId)?.resolve(payload);
				return;
			case "error": {
				const details = (payload as RunnerErrorPayload)?.error;
				const error = new RunnerError(
					details?.message || `${this.label} runner error`,
				);
				error.name = details?.type || "RunnerError";
				error.code = details?.code ?? null;
				this.settle(messageId)?.reject(error);
				return;
			}
		}
	};
}

/**
 * Runners report transformers.js progress shapes (`progress` 0-100, `loaded`,
 * `total`, `file`). Hosts only need a percent and a label.
 */
export function normalizeProgress(payload: unknown): ProgressEvent {
	const data = (payload ?? {}) as Record<string, unknown>;
	const loaded = typeof data.loaded === "number" ? data.loaded : 0;
	const total = typeof data.total === "number" ? data.total : 0;
	const percent =
		typeof data.percent === "number"
			? data.percent
			: typeof data.progress === "number"
				? data.progress
				: total > 0
					? (loaded / total) * 100
					: 0;
	const text =
		typeof data.text === "string"
			? data.text
			: typeof data.file === "string"
				? data.file
				: undefined;
	return {
		loaded,
		total,
		percent: Math.max(0, Math.min(100, percent)),
		text,
	};
}
