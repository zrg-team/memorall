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

// Local OpenAI-compatible LLM (works for LM Studio and Ollama /v1 endpoints)
export class LocalOpenAICompatibleLLM implements BaseLLM {
	name = "local-openai";
	private ready = false;
	private baseURL: string;
	private apiKey?: string; // optional for local
	private providerType: string;

	constructor(baseURL?: string, apiKey?: string, providerType?: string) {
		this.baseURL = (baseURL || "http://localhost:1234/v1").replace(/\/$/, "");
		this.apiKey = apiKey;
		this.providerType = providerType || "custom";
	}

	async initialize(): Promise<void> {
		if (this.ready) return;
		// No network probe to keep startup snappy in local contexts
		this.ready = true;
	}

	isReady(): boolean {
		return this.ready;
	}

	async getMaxModelTokens(): Promise<number> {
		return 10000;
	}

	private headers(): HeadersInit {
		const h: HeadersInit = { "Content-Type": "application/json" };
		if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
		return h;
	}

	async models(): Promise<ModelsResponse> {
		try {
			const res = await fetch(`${this.baseURL}/models`, {
				headers: this.headers(),
			});
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			const data = await res.json();
			const now = Math.floor(Date.now() / 1000);
			const models: ModelInfo[] = (
				Array.isArray(data?.data) ? data.data : []
			).map((m: any) => ({
				id: String(m?.id || m?.name || m?.model || "unknown-model"),
				name: String(m?.id || m?.name || m?.model || "unknown-model"),
				object: "model",
				created: Number(m?.created || now),
				owned_by: String(m?.owned_by || "local"),
				loaded: true,
			}));
			return { object: "list", data: models };
		} catch {
			// Some local servers may not expose /models; return empty list gracefully
			return { object: "list", data: [] };
		}
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

		const body = {
			model: request.model || "local-model",
			messages: request.messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			max_tokens: request.max_tokens,
			temperature: request.temperature,
			top_p: request.top_p,
			stop: request.stop,
			stream: false,
		};

		const res = await fetch(`${this.baseURL}/chat/completions`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
			signal: request.signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`Local OpenAI completion failed: ${res.status} ${res.statusText} ${text}`,
			);
		}
		const data = await res.json();
		const created = Number(data.created || Math.floor(Date.now() / 1000));
		const model = String(data.model || body.model);

		return {
			id: String(data.id || `chatcmpl_${created}`),
			object: "chat.completion",
			created,
			model,
			choices: (data.choices || []).map((choice: any, i: number) => ({
				index: Number(choice.index ?? i),
				message: {
					role: "assistant",
					content: String(choice?.message?.content ?? ""),
				},
				finish_reason: (choice.finish_reason || "stop") as "stop" | "length",
			})),
			usage: {
				prompt_tokens: Number(data?.usage?.prompt_tokens ?? 0),
				completion_tokens: Number(data?.usage?.completion_tokens ?? 0),
				total_tokens: Number(data?.usage?.total_tokens ?? 0),
			},
		};
	}

	private async *createStreamingCompletion(
		request: ChatCompletionRequest,
	): AsyncIterableIterator<ChatCompletionChunk> {
		if (!this.ready) await this.initialize();

		const body = {
			model: request.model || "local-model",
			messages: request.messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			max_tokens: request.max_tokens,
			temperature: request.temperature,
			top_p: request.top_p,
			stop: request.stop,
			stream: true,
		};

		const res = await fetch(`${this.baseURL}/chat/completions`, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
			signal: request.signal,
		});
		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`Local OpenAI streaming failed: ${res.status} ${res.statusText} ${text}`,
			);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder("utf-8");
		let buffer = "";
		const model = String(body.model);
		let sentFirst = false;

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() || "";
			for (const line of lines) {
				const t = line.trim();
				if (!t) continue;
				const prefix = "data:";
				if (!t.startsWith(prefix)) continue;
				const dataStr = t.substring(prefix.length).trim();
				if (dataStr === "[DONE]") {
					const finalChunk: ChatCompletionChunk = {
						id: `chatcmpl_${Date.now()}`,
						object: "chat.completion.chunk",
						created: Math.floor(Date.now() / 1000),
						model,
						choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					};
					yield finalChunk;
					return;
				}
				try {
					const json = JSON.parse(dataStr);
					const choice = Array.isArray(json.choices)
						? json.choices[0]
						: undefined;
					if (!choice) continue;
					const chunk: ChatCompletionChunk = {
						id: String(json.id || `chatcmpl_${Date.now()}`),
						object: "chat.completion.chunk",
						created: Number(json.created || Math.floor(Date.now() / 1000)),
						model: String(json.model || model),
						choices: [
							{
								index: Number(choice.index ?? 0),
								delta: {
									role: sentFirst ? undefined : ("assistant" as const),
									content: choice?.delta?.content ?? undefined,
								},
								finish_reason: (choice.finish_reason ?? null) as
									| "stop"
									| "length"
									| null,
							},
						],
					};
					sentFirst = true;
					yield chunk;
				} catch {
					// ignore malformed lines
				}
			}
		}
	}

	async unload(_modelId: string): Promise<void> {
		// No unload concept in OpenAI-compatible HTTP
	}

	async delete(_modelId: string): Promise<void> {
		throw new Error("Cannot delete local models via OpenAI-compatible API");
	}

	getInfo() {
		return {
			name: this.name,
			type: this.providerType as "wllama" | "openai" | "custom",
			ready: this.ready,
		};
	}
}
