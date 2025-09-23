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

// A lightweight OpenAI-compatible client using fetch/SSE.
// Supports both OpenAI and local OpenAI-compatible servers (LM Studio, Ollama).
export class OpenAILLM implements BaseLLM {
	name = "openai";
	private ready = false;
	private apiKey: string;
	private baseURL: string;

	constructor(apiKey?: string, baseURL?: string) {
		this.apiKey = apiKey || "";
		this.baseURL = (baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
	}

	private isLocalBase(): boolean {
		try {
			const u = new URL(this.baseURL);
			const host = u.hostname;
			return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
		} catch {
			return false;
		}
	}

	private getHeaders(): HeadersInit {
		const headers: HeadersInit = {
			"Content-Type": "application/json",
		};
		// Only send Authorization when we actually have an API key
		if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
		return headers;
	}

	async initialize(): Promise<void> {
		if (this.ready) return;

		// For OpenAI cloud, enforce API key; for local compat servers, skip.
		const isDefaultOpenAI = this.baseURL === "https://api.openai.com/v1";
		if (isDefaultOpenAI && !this.apiKey) {
			throw new Error("OpenAI API key is required");
		}

		// Mark ready without probing the network to support offline/local cases.
		this.ready = true;
	}

	isReady(): boolean {
		return this.ready;
	}

	async models(): Promise<ModelsResponse> {
		// GET {baseURL}/models (OpenAI-compatible). Some local servers may not implement this.
		try {
			const res = await fetch(`${this.baseURL}/models`, {
				method: "GET",
				headers: this.getHeaders(),
			});
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			const data = await res.json();
			const modelsRaw = Array.isArray(data?.data) ? data.data : [];
			const now = Math.floor(Date.now() / 1000);
			const modelInfos: ModelInfo[] = modelsRaw.map((m: any) => ({
				id: String(m.id || m.name || m.model || "unknown-model"),
				name: String(m.id || m.name || m.model || "unknown-model"),
				object: "model",
				created: Number(m.created || now),
				owned_by: String(
					m.owned_by || (this.isLocalBase() ? "local" : "openai"),
				),
				loaded: true,
				provider: "openai",
			}));
			return { object: "list", data: modelInfos };
		} catch (error) {
			// For local servers that don't support /models, return an empty list gracefully
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
			model: request.model || "gpt-3.5-turbo",
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
			headers: this.getHeaders(),
			body: JSON.stringify(body),
			signal: request.signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`OpenAI completion failed: ${res.status} ${res.statusText} ${text}`,
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
					content: String(
						choice?.message?.content ?? choice?.delta?.content ?? "",
					),
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
			model: request.model || "gpt-3.5-turbo",
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
			headers: this.getHeaders(),
			body: JSON.stringify(body),
			signal: request.signal,
		});
		if (!res.ok || !res.body) {
			const text = await res.text().catch(() => "");
			throw new Error(
				`OpenAI streaming completion failed: ${res.status} ${res.statusText} ${text}`,
			);
		}

		const reader = res.body.getReader();
		const decoder = new TextDecoder("utf-8");
		let buffer = "";
		const model = body.model as string;

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() || ""; // keep last partial line

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				// Expect SSE: lines starting with "data:"
				const prefix = "data:";
				if (!trimmed.startsWith(prefix)) continue;
				const dataStr = trimmed.substring(prefix.length).trim();
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
									role: choice?.delta?.role as "assistant" | undefined,
									content: choice?.delta?.content ?? undefined,
								},
								finish_reason: (choice.finish_reason ?? null) as
									| "stop"
									| "length"
									| null,
							},
						],
					};
					yield chunk;
				} catch {
					// Ignore malformed lines
				}
			}
		}
	}

	async unload(_modelId: string): Promise<void> {
		// Remote/local OpenAI-compatible servers don't have an unload concept
	}

	async delete(_modelId: string): Promise<void> {
		// Deleting models isn't supported via the OpenAI-compatible API
		throw new Error("Cannot delete OpenAI-compatible models");
	}

	getInfo(): {
		name: string;
		type: "wllama" | "openai" | "custom";
		ready: boolean;
	} {
		return {
			name: this.name,
			type: "openai",
			ready: this.ready,
		};
	}
}
