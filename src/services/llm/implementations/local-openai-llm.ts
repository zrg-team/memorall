import type {
	BaseLLM,
	LLMInfo,
	LLMType,
	ModelInfo,
	ModelsResponse,
} from "../interfaces/base-llm";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionMessageParam,
	ChatCompletionChunkToolCall,
	ChatCompletionFinishReason,
} from "@/types/openai";
import type { ToolCapabilityInfo } from "../interfaces/tool-capability";
import {
	NATIVE_TOOL_SUPPORT,
	PROMPT_TOOL_SUPPORT,
	NO_TOOL_SUPPORT,
} from "../interfaces/tool-capability";
import {
	injectToolsIntoSystemPrompt,
	extractToolCallsFromResponse,
} from "../tools/tool-adapter";
import {
	extractChunkOutputText,
	extractResponseOutputText,
	normalizeTokenUsage,
	resolveTokenUsage,
} from "../utils/token-usage";
import { postCompletionWithBudgetRetry } from "../utils/budget-retry";

// Model patterns for local servers
const MODEL_TOOL_PATTERNS: Array<{
	pattern: RegExp;
	capability: ToolCapabilityInfo;
}> = [
	// Llama 3+ - native support in Ollama
	{
		pattern: /llama-?3/i,
		capability: { ...NATIVE_TOOL_SUPPORT, streamingToolCalls: false },
	},
	{ pattern: /llama-?4/i, capability: NATIVE_TOOL_SUPPORT },
	// Mistral - native support
	{
		pattern: /mistral/i,
		capability: { ...NATIVE_TOOL_SUPPORT, streamingToolCalls: false },
	},
	// Qwen 2.5 - native support
	{
		pattern: /qwen.*2\.5/i,
		capability: { ...NATIVE_TOOL_SUPPORT, streamingToolCalls: false },
	},
	// DeepSeek - native for v3/r1
	{
		pattern: /deepseek.*(v3|r1|coder)/i,
		capability: {
			...NATIVE_TOOL_SUPPORT,
			parallelCalls: false,
			streamingToolCalls: false,
		},
	},
	// Phi - prompt injection only
	{ pattern: /phi/i, capability: PROMPT_TOOL_SUPPORT },
	// Small/quantized models - usually no support
	{ pattern: /tiny|small|mini|nano/i, capability: NO_TOOL_SUPPORT },
];

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

	async getMaxModelTokens(model?: string): Promise<number> {
		// Default fallback for unknown models
		return 10000;
	}

	async getMaxResponseTokens(model?: string): Promise<number> {
		// Default fallback for unknown models (80% of context window)
		return Math.round(10000 * 0.5);
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

	private serializeMessages(
		messages: ChatCompletionMessageParam[],
	): Record<string, unknown>[] {
		return messages.map((m) => {
			const base: Record<string, unknown> = {
				role: m.role,
				content: m.content,
			};
			if (m.role === "assistant" && m.tool_calls) {
				base.tool_calls = m.tool_calls;
			}
			if (m.role === "tool") {
				base.tool_call_id = m.tool_call_id;
			}
			if ("name" in m && m.name) {
				base.name = m.name;
			}
			return base;
		});
	}

	private async createCompletion(
		request: ChatCompletionRequest,
	): Promise<ChatCompletionResponse> {
		if (!this.ready) await this.initialize();

		// Check if model supports native tools or needs prompt injection
		const capability = await this.getToolCapabilities(request.model);
		let processedRequest = request;
		let usePromptInjection = false;

		if (request.tools?.length && capability.mode === "prompt_injection") {
			processedRequest = injectToolsIntoSystemPrompt(request);
			usePromptInjection = true;
		}

		const body: Record<string, unknown> = {
			model: processedRequest.model,
			messages: this.serializeMessages(processedRequest.messages),
			max_tokens: processedRequest.max_tokens,
			temperature: processedRequest.temperature,
			top_p: processedRequest.top_p,
			stop: processedRequest.stop,
			stream: false,
		};

		// Add tools if native support and tools provided
		if (request.tools?.length && capability.mode === "native") {
			body.tools = request.tools;
			if (request.tool_choice) {
				body.tool_choice = request.tool_choice;
			}
			if (request.parallel_tool_calls !== undefined) {
				body.parallel_tool_calls = request.parallel_tool_calls;
			}
		}

		const res = await postCompletionWithBudgetRetry({
			url: `${this.baseURL}/chat/completions`,
			headers: this.headers(),
			body,
			signal: request.signal,
			label: "LocalOpenAICompatibleLLM",
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

		let response: ChatCompletionResponse = {
			id: String(data.id || `chatcmpl_${created}`),
			object: "chat.completion",
			created,
			model,
			choices: (data.choices || []).map((choice: any, i: number) => ({
				index: Number(choice.index ?? i),
				message: {
					role: "assistant",
					content: choice?.message?.content ?? null,
					tool_calls: choice?.message?.tool_calls,
				},
				finish_reason: (choice.finish_reason ||
					"stop") as ChatCompletionFinishReason,
			})),
			usage: undefined,
		};

		response = {
			...response,
			usage: resolveTokenUsage(
				data?.usage,
				processedRequest.messages,
				extractResponseOutputText(response),
			),
		};

		// Extract tool calls from text if using prompt injection
		if (usePromptInjection) {
			response = extractToolCallsFromResponse(response);
		}

		return response;
	}

	private async *createStreamingCompletion(
		request: ChatCompletionRequest,
	): AsyncIterableIterator<ChatCompletionChunk> {
		if (!this.ready) await this.initialize();

		// Check if model supports native tools or needs prompt injection
		const capability = await this.getToolCapabilities(request.model);
		let processedRequest = request;

		if (request.tools?.length && capability.mode === "prompt_injection") {
			processedRequest = injectToolsIntoSystemPrompt(request);
		}

		const body: Record<string, unknown> = {
			model: processedRequest.model || "local-model",
			messages: this.serializeMessages(processedRequest.messages),
			max_tokens: processedRequest.max_tokens,
			temperature: processedRequest.temperature,
			top_p: processedRequest.top_p,
			stop: processedRequest.stop,
			stream: true,
			stream_options: { include_usage: true },
		};

		// Add tools if native support and tools provided
		if (request.tools?.length && capability.mode === "native") {
			body.tools = request.tools;
			if (request.tool_choice) {
				body.tool_choice = request.tool_choice;
			}
			if (request.parallel_tool_calls !== undefined) {
				body.parallel_tool_calls = request.parallel_tool_calls;
			}
		}

		const res = await postCompletionWithBudgetRetry({
			url: `${this.baseURL}/chat/completions`,
			headers: this.headers(),
			body,
			signal: request.signal,
			label: "LocalOpenAICompatibleLLM",
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
		let completionOutput = "";
		let finalUsage = normalizeTokenUsage(undefined);

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
					if (!finalUsage) {
						finalChunk.usage = resolveTokenUsage(
							undefined,
							processedRequest.messages,
							completionOutput,
						);
					}
					yield finalChunk;
					return;
				}
				try {
					const json = JSON.parse(dataStr);
					const choice = Array.isArray(json.choices)
						? json.choices[0]
						: undefined;

					// Usage-only chunk (some servers send this as the last chunk with stream_options.include_usage)
					if (!choice && json.usage) {
						const usage = normalizeTokenUsage(json.usage);
						if (usage) {
							finalUsage = usage;
						}
						yield {
							id: String(json.id || `chatcmpl_${Date.now()}`),
							object: "chat.completion.chunk",
							created: Number(json.created || Math.floor(Date.now() / 1000)),
							model: String(json.model || model),
							choices: [],
							usage,
						};
						continue;
					}

					if (!choice) continue;

					// Handle tool_calls in streaming
					const toolCalls: ChatCompletionChunkToolCall[] | undefined =
						choice?.delta?.tool_calls;
					const usage = normalizeTokenUsage(json.usage);
					if (usage) {
						finalUsage = usage;
					}

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
									tool_calls: toolCalls,
								},
								finish_reason: (choice.finish_reason ??
									null) as ChatCompletionFinishReason,
							},
						],
						usage,
					};
					completionOutput += extractChunkOutputText(chunk);
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

	async getToolCapabilities(model?: string): Promise<ToolCapabilityInfo> {
		if (!model) {
			return NO_TOOL_SUPPORT;
		}

		// Check model-specific patterns
		for (const { pattern, capability } of MODEL_TOOL_PATTERNS) {
			if (pattern.test(model)) {
				return capability;
			}
		}

		// Provider-specific defaults
		if (this.providerType === "ollama") {
			return {
				...PROMPT_TOOL_SUPPORT,
				notes: "Check Ollama model card for tool support",
			};
		}

		if (this.providerType === "lmstudio") {
			return {
				...PROMPT_TOOL_SUPPORT,
				notes: "Tool support depends on loaded model",
			};
		}

		return NO_TOOL_SUPPORT;
	}

	async supportsTools(model?: string): Promise<boolean> {
		const capability = await this.getToolCapabilities(model);
		return capability.supported;
	}

	getInfo(): LLMInfo {
		return {
			name: this.name,
			type: this.providerType as LLMType,
			ready: this.ready,
		};
	}
}
