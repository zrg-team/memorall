import type {
	BaseLLM,
	ModelInfo,
	ModelsResponse,
} from "../interfaces/base-llm";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import { LLM_RUNNER_URLS } from "@/config/llm-runner";
import { waitForDOMReady } from "@/utils/dom";

interface ServeRequest {
	model: string;
}

interface UnloadRequest {
	model: string;
}

interface DeleteRequest {
	model: string;
}

interface ProgressEvent {
	loaded: number;
	total: number;
	percent: number;
}

interface BaseMessage {
	messageId: string;
}

interface OutgoingMessage extends BaseMessage {
	type: "init" | "serve" | "models" | "chat/completions" | "unload" | "delete";
	payload?: unknown;
}

interface IncomingMessage extends BaseMessage {
	type:
		| "ready"
		| "complete"
		| "error"
		| "progress"
		| "stream_chunk"
		| "stream_end";
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
	onProgress?: (progress: ProgressEvent) => void;
	onStreamChunk?: (chunk: ChatCompletionChunk) => void;
	signalId?: string;
};

export class WllamaLLM implements BaseLLM {
	name = "wllama";
	private iframe: HTMLIFrameElement | null = null;
	private ready = false;
	private loading = false;
	private pending = new Map<string, PendingRequest>();
	private signalMap = new Map<string, AbortSignal>();
	private url: string;

	constructor(url = LLM_RUNNER_URLS?.wllama) {
		this.url = url;
	}

	async initialize(): Promise<void> {
		if (this.ready) return;
		if (this.loading) {
			while (this.loading) await new Promise((r) => setTimeout(r, 50));
			return;
		}
		this.loading = true;
		try {
			// Wait for DOM to be ready before accessing document
			await waitForDOMReady();
			this.iframe = document.createElement("iframe");
			this.iframe.src = this.url;
			this.iframe.style.display = "none";
			document.body.appendChild(this.iframe);

			window.addEventListener("message", this.onMessage);

			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("Runner not ready")),
					15000,
				);
				const handler = (e: MessageEvent<IncomingMessage>) => {
					if (e.data?.messageId === "RUNNER_READY") {
						clearTimeout(timeout);
						window.removeEventListener("message", handler);
						resolve();
					}
				};
				window.addEventListener("message", handler);
			});

			await this.send("init");
			this.ready = true;
		} finally {
			this.loading = false;
		}
	}

	isReady(): boolean {
		return this.ready;
	}

	async getMaxModelTokens(): Promise<number> {
		return 4096;
	}

	async models(): Promise<ModelsResponse> {
		if (!this.ready) await this.initialize();
		const response = (await this.send("models")) as ModelsResponse;
		response.data.forEach((model) => {
			model.provider = "wllama";
		});
		return response;
	}

	chatCompletions(
		request: ChatCompletionRequest & { stream?: false },
	): Promise<ChatCompletionResponse>;
	chatCompletions(
		request: ChatCompletionRequest & { stream: true },
	): AsyncIterableIterator<ChatCompletionChunk>;
	chatCompletions(
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (request.stream) {
			return this.createStreamingCompletion(request);
		} else {
			return this.createCompletion(request);
		}
	}

	private async createCompletion(
		request: ChatCompletionRequest,
	): Promise<ChatCompletionResponse> {
		if (!this.ready) await this.initialize();

		// Remove signal from request payload (can't serialize AbortSignal)
		const { signal, ...requestPayload } = request;

		let signalId: string | undefined;
		if (signal) {
			signalId = Math.random().toString(36).slice(2);
			this.signalMap.set(signalId, signal);
		}

		try {
			const response = await this.send("chat/completions", requestPayload, {
				signalId,
			});
			return response as ChatCompletionResponse;
		} finally {
			if (signalId) {
				this.signalMap.delete(signalId);
			}
		}
	}

	private async *createStreamingCompletion(
		request: ChatCompletionRequest,
	): AsyncIterableIterator<ChatCompletionChunk> {
		if (!this.ready) await this.initialize();

		// Remove signal from request payload (can't serialize AbortSignal)
		const { signal, ...requestPayload } = request;

		let signalId: string | undefined;
		if (signal) {
			signalId = Math.random().toString(36).slice(2);
			this.signalMap.set(signalId, signal);
		}

		try {
			const chunks: ChatCompletionChunk[] = [];
			let streamEnded = false;
			let streamError: Error | null = null;

			const chunkHandler = (chunk: ChatCompletionChunk) => {
				chunks.push(chunk);
			};

			const streamPromise = this.send("chat/completions", requestPayload, {
				onStreamChunk: chunkHandler,
				signalId,
			}).catch((error) => {
				streamError = error;
				streamEnded = true;
			});

			// Wait for chunks to arrive
			while (!streamEnded && !streamError) {
				if (chunks.length > 0) {
					const chunk = chunks.shift()!;
					yield chunk;
					if (chunk.choices[0]?.finish_reason) {
						streamEnded = true;
					}
				} else {
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}

			// Yield any remaining chunks
			while (chunks.length > 0) {
				yield chunks.shift()!;
			}

			if (streamError) {
				throw streamError;
			}

			await streamPromise;
		} finally {
			if (signalId) {
				this.signalMap.delete(signalId);
			}
		}
	}

	async unload(modelId: string): Promise<void> {
		if (!this.ready) await this.initialize();
		const parts = modelId.split("/");
		if (parts.length < 3) {
			throw new Error('Model ID must be in format "username/repo/filename"');
		}
		const request: UnloadRequest = { model: modelId };
		await this.send("unload", request);
	}

	async delete(modelId: string): Promise<void> {
		if (!this.ready) await this.initialize();
		const parts = modelId.split("/");
		if (parts.length < 3) {
			throw new Error('Model ID must be in format "username/repo/filename"');
		}
		const request: DeleteRequest = { model: modelId };
		await this.send("delete", request);
	}

	getInfo(): {
		name: string;
		type: "wllama" | "openai" | "custom";
		ready: boolean;
	} {
		return {
			name: this.name,
			type: "wllama",
			ready: this.ready,
		};
	}

	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		if (!this.ready) await this.initialize();
		const parts = model.split("/");
		if (parts.length < 3) {
			throw new Error('Model must be in format "username/repo/filename"');
		}

		// Avoid reloading a model that's already active inside the runner
		const existingModels = await this.models();
		const existingModel = existingModels.data.find(
			(m) => m.loaded && m.id.toLowerCase() === model.toLowerCase(),
		);
		if (existingModel) {
			if (onProgress) {
				onProgress({
					loaded: existingModel.size ?? 0,
					total: existingModel.size ?? 0,
					percent: 100,
				});
			}
			return existingModel;
		}
		const request: ServeRequest = { model };
		const response = await this.send("serve", request, { onProgress });
		return response as ModelInfo;
	}

	async loadModelFromHF(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<void> {
		// Ensure model is in the correct 3-part format
		const parts = model.split("/");
		if (parts.length < 3) {
			throw new Error('Model must be in format "username/repo/filename"');
		}

		await this.serve(model, onProgress);
	}

	destroy(): void {
		this.iframe?.remove();
		this.iframe = null;
		window.removeEventListener("message", this.onMessage);
		this.pending.forEach(({ reject }) =>
			reject(new Error("Service destroyed")),
		);
		this.pending.clear();
		this.ready = false;
	}

	private onMessage = (ev: MessageEvent<IncomingMessage>) => {
		const { messageId, type, payload } = ev.data || {};

		if (type === "progress") {
			const progressData = payload as ProgressEvent;
			window.dispatchEvent(
				new CustomEvent("wllama:progress", { detail: progressData }),
			);

			for (const [, request] of this.pending.entries()) {
				if (request.onProgress) {
					request.onProgress(progressData);
				}
			}
			return;
		}

		if (type === "stream_chunk") {
			const chunk = payload as ChatCompletionChunk;
			for (const [, request] of this.pending.entries()) {
				if (request.onStreamChunk) {
					request.onStreamChunk(chunk);
				}
			}
			return;
		}

		if (type === "stream_end") {
			const chunk = payload as ChatCompletionChunk;
			for (const [, request] of this.pending.entries()) {
				if (request.onStreamChunk) {
					request.onStreamChunk(chunk);
					request.resolve(undefined);
				}
			}
			return;
		}

		if (!messageId) return;

		const pendingRequest = this.pending.get(messageId);
		if (!pendingRequest) return;

		this.pending.delete(messageId);

		if (type === "complete") {
			pendingRequest.resolve(payload);
		} else if (type === "error") {
			const errorData = payload as ErrorResponse;
			const error = new Error(errorData.error?.message || "Unknown error");
			pendingRequest.reject(error);
		}
	};

	private send(
		type: OutgoingMessage["type"],
		payload?: unknown,
		options?: {
			onProgress?: (progress: ProgressEvent) => void;
			onStreamChunk?: (chunk: ChatCompletionChunk) => void;
			signalId?: string;
		},
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const target = this.iframe?.contentWindow;
			if (!target) return reject(new Error("Runner iframe not ready"));

			const id = Math.random().toString(36).slice(2);
			this.pending.set(id, {
				resolve,
				reject,
				onProgress: options?.onProgress,
				onStreamChunk: options?.onStreamChunk,
				signalId: options?.signalId,
			});

			// Set up abort signal listener if signalId provided
			if (options?.signalId) {
				const signal = this.signalMap.get(options.signalId);
				if (signal) {
					const abortHandler = () => {
						this.pending.delete(id);
						reject(new Error("Operation aborted"));
						target.postMessage({ messageId: id, type: "abort" }, "*");
					};

					if (signal.aborted) {
						abortHandler();
						return;
					}

					signal.addEventListener("abort", abortHandler, { once: true });
				}
			}

			try {
				const message: OutgoingMessage = { messageId: id, type, payload };
				target.postMessage(message, "*");
			} catch (e) {
				this.pending.delete(id);
				reject(e);
			}
		});
	}
}
