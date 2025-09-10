import type { BaseEmbedding } from "../interfaces/base-embedding";
import { LLM_RUNNER_URLS } from "@/config/llm-runner";

interface BaseMessage {
	messageId: string;
}

interface OutgoingMessage extends BaseMessage {
	type: "init" | "embeddings" | "models";
	payload?: unknown;
}

interface IncomingMessage extends BaseMessage {
	type: "ready" | "complete" | "error";
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

export interface WorkerEmbeddingOptions {
	modelName?: string;
	runnerUrl?: string;
}

export class WorkerEmbedding implements BaseEmbedding {
	name: string;
	dimensions: number = 0;
	private iframe: HTMLIFrameElement | null = null;
	private ready = false;
	private loading = false;
	private pending = new Map<string, PendingRequest>();
	private url: string;
	private modelName: string;

	constructor(options: WorkerEmbeddingOptions = {}) {
		this.modelName = options.modelName || "nomic-ai/nomic-embed-text-v1.5";
		this.name = this.modelName;
		const baseUrl = options.runnerUrl || LLM_RUNNER_URLS?.embedding;
		this.url = `${baseUrl}?mode=embedding&model=${encodeURIComponent(this.modelName)}`;
	}

	async initialize(): Promise<void> {
		if (this.ready) return;
		if (this.loading) {
			while (this.loading) await new Promise((r) => setTimeout(r, 50));
			return;
		}
		this.loading = true;
		try {
			this.iframe = document.createElement("iframe");
			this.iframe.src = this.url;
			this.iframe.style.display = "none";
			document.body.appendChild(this.iframe);

			window.addEventListener("message", this.onMessage);

			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("Embedding runner not ready")),
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

			await this.send("init", { modelName: this.modelName });

			// Get model info to set dimensions (embedding models typically have known dimensions)
			this.dimensions = 768; // Default for most embedding models, will be updated if needed

			this.ready = true;
		} finally {
			this.loading = false;
		}
	}

	isReady(): boolean {
		return this.ready;
	}

	async textToVector(text: string): Promise<number[]> {
		if (!this.ready) await this.initialize();
		const response = (await this.send("embeddings", { input: text })) as {
			data: Array<{ embedding: number[] }>;
		};
		return response.data[0].embedding;
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		if (!this.ready) await this.initialize();
		const response = (await this.send("embeddings", { input: texts })) as {
			data: Array<{ embedding: number[] }>;
		};
		return response.data.map((item) => item.embedding);
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
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const target = this.iframe?.contentWindow;
			if (!target)
				return reject(new Error("Embedding runner iframe not ready"));

			const id = Math.random().toString(36).slice(2);
			this.pending.set(id, { resolve, reject });

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
