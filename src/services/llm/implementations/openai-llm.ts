import type {
	BaseLLM,
	LLMInfo,
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
import { NATIVE_TOOL_SUPPORT } from "../interfaces/tool-capability";
import {
	extractChunkOutputText,
	extractResponseOutputText,
	normalizeTokenUsage,
	resolveTokenUsage,
} from "../utils/token-usage";
import { postCompletionWithBudgetRetry } from "../utils/budget-retry";

// Well-known model configurations with context window and max response tokens
interface ModelConfig {
	pattern: string; // Simplified pattern for matching (no special chars)
	contextWindow: number; // Total context window in tokens
	maxResponseTokens: number; // Maximum tokens for response
}

const WELL_KNOWN_MODELS: ModelConfig[] = [
	// OpenAI GPT-5 (August 2025) - Latest flagship
	{ pattern: "gpt5", contextWindow: 400000, maxResponseTokens: 128000 },

	// OpenAI GPT-4.1 (2025) - 1M context window
	{ pattern: "gpt41", contextWindow: 1000000, maxResponseTokens: 128000 },

	// OpenAI GPT-4o (2024-2025)
	{ pattern: "gpt4o", contextWindow: 128000, maxResponseTokens: 16384 },
	{ pattern: "gpt4omini", contextWindow: 128000, maxResponseTokens: 16384 },

	// OpenAI GPT-4 Turbo
	{ pattern: "gpt4turbo", contextWindow: 128000, maxResponseTokens: 4096 },

	// OpenAI o1 models (2024)
	{ pattern: "o1", contextWindow: 200000, maxResponseTokens: 100000 },
	{ pattern: "o1preview", contextWindow: 128000, maxResponseTokens: 32768 },
	{ pattern: "o1mini", contextWindow: 128000, maxResponseTokens: 65536 },

	// Anthropic Claude Sonnet 4 (2025) - 1M beta context
	{ pattern: "claude4", contextWindow: 1000000, maxResponseTokens: 64000 },
	{
		pattern: "claudesonnet4",
		contextWindow: 1000000,
		maxResponseTokens: 64000,
	},
	{ pattern: "claudeopus41", contextWindow: 200000, maxResponseTokens: 64000 },

	// Anthropic Claude 3.5 (2024-2025)
	{ pattern: "claude35sonnet", contextWindow: 200000, maxResponseTokens: 8192 },
	{ pattern: "claude35haiku", contextWindow: 200000, maxResponseTokens: 8192 },
	{ pattern: "claude37", contextWindow: 200000, maxResponseTokens: 128000 },

	// Anthropic Claude 3 (2024)
	{ pattern: "claude3opus", contextWindow: 200000, maxResponseTokens: 4096 },
	{ pattern: "claude3sonnet", contextWindow: 200000, maxResponseTokens: 4096 },
	{ pattern: "claude3haiku", contextWindow: 200000, maxResponseTokens: 4096 },

	// Google Gemini 2.5 (2025)
	{ pattern: "gemini25pro", contextWindow: 1048576, maxResponseTokens: 65535 },
	{
		pattern: "gemini25flash",
		contextWindow: 1048576,
		maxResponseTokens: 65535,
	},

	// Google Gemini 2.0 (2024-2025)
	{ pattern: "gemini20flash", contextWindow: 1048576, maxResponseTokens: 8192 },
	{ pattern: "gemini2flash", contextWindow: 1048576, maxResponseTokens: 8192 },

	// Google Gemini 1.5 (2024) - up to 2M tokens
	{ pattern: "gemini15pro", contextWindow: 2097152, maxResponseTokens: 8192 },
	{ pattern: "gemini15flash", contextWindow: 1048576, maxResponseTokens: 8192 },

	// Meta Llama 4 (April 2025) - 10M context for Scout!
	{ pattern: "llama4scout", contextWindow: 10000000, maxResponseTokens: 8192 },
	{
		pattern: "llama4maverick",
		contextWindow: 1000000,
		maxResponseTokens: 8192,
	},
	{ pattern: "llama4", contextWindow: 1000000, maxResponseTokens: 8192 },

	// Meta Llama 3.1 (2024) - 128K context
	{ pattern: "llama31", contextWindow: 128000, maxResponseTokens: 8192 },
	{ pattern: "llama3", contextWindow: 128000, maxResponseTokens: 4096 },

	// Mistral AI (2025) - 128K context for flagship models
	{ pattern: "mistrallarge", contextWindow: 128000, maxResponseTokens: 4096 },
	{ pattern: "mistralmedium", contextWindow: 128000, maxResponseTokens: 4096 },
	{ pattern: "mistralnemo", contextWindow: 128000, maxResponseTokens: 4096 },
	{ pattern: "mistralsmall", contextWindow: 32000, maxResponseTokens: 4096 },

	// Qwen 2.5 (Alibaba 2024-2025)
	{ pattern: "qwen25", contextWindow: 131072, maxResponseTokens: 8192 },
	{ pattern: "qwen2", contextWindow: 32768, maxResponseTokens: 8192 },

	// DeepSeek V4 (2025) - 1M+ context preview
	{ pattern: "deepseekv4", contextWindow: 1000000, maxResponseTokens: 64000 },

	// DeepSeek V3.1 (August 2025) - 128K context
	{ pattern: "deepseekv31", contextWindow: 128000, maxResponseTokens: 64000 },
	{ pattern: "deepseekv3", contextWindow: 128000, maxResponseTokens: 64000 },

	// DeepSeek R1 & V3 (2025) - 64K context
	{ pattern: "deepseekr1", contextWindow: 64000, maxResponseTokens: 64000 },
	{ pattern: "deepseek", contextWindow: 64000, maxResponseTokens: 32000 },
];

/**
 * Used when neither the provider nor the pattern table knows the model. Kept
 * conservative on purpose: overstating the window makes the agent overfill its
 * context and the request fails upstream, which is worse than budgeting low.
 */
const UNKNOWN_MODEL_CONTEXT_WINDOW = 10000;
const UNKNOWN_MODEL_RESPONSE_TOKENS = 5000;

const positiveInteger = (value: unknown): number | null => {
	const parsed = typeof value === "string" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
		? Math.floor(parsed)
		: null;
};

/**
 * Read the context limits an OpenAI-compatible listing reports for one model.
 *
 * OpenRouter uses `context_length` plus `top_provider.max_completion_tokens`;
 * other gateways use `max_model_len` (vLLM) or `context_window`. When only the
 * window is known, leave room for a reply rather than claiming the whole window
 * can be generated.
 */
function readReportedLimits(entry: any): ModelConfig | null {
	const contextWindow =
		positiveInteger(entry?.context_length) ??
		positiveInteger(entry?.context_window) ??
		positiveInteger(entry?.max_model_len);
	if (!contextWindow) return null;

	const reportedResponse =
		positiveInteger(entry?.top_provider?.max_completion_tokens) ??
		positiveInteger(entry?.max_completion_tokens) ??
		positiveInteger(entry?.max_output_tokens);

	return {
		pattern: "",
		contextWindow,
		maxResponseTokens: Math.min(
			reportedResponse ?? Math.round(contextWindow / 2),
			contextWindow,
		),
	};
}

/**
 * Normalize model name by removing special characters and converting to lowercase
 */
function normalizeModelName(modelName: string): string {
	return modelName.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find matching model configuration by checking if normalized model name includes pattern
 */
function findModelConfig(modelName: string): ModelConfig | null {
	const normalized = normalizeModelName(modelName);
	return (
		WELL_KNOWN_MODELS.find((config) => normalized.includes(config.pattern)) ||
		null
	);
}

// Tool support patterns for OpenAI models
const TOOL_SUPPORT_PATTERNS: Array<{
	pattern: RegExp;
	capability: ToolCapabilityInfo;
}> = [
	// GPT-4 family - full support
	{ pattern: /^gpt-4/i, capability: NATIVE_TOOL_SUPPORT },
	// GPT-3.5 - full support
	{ pattern: /^gpt-3\.5/i, capability: NATIVE_TOOL_SUPPORT },
	// o1/o3 models - limited parallel calls
	{
		pattern: /^o[134]/i,
		capability: {
			...NATIVE_TOOL_SUPPORT,
			parallelCalls: false,
			notes: "Reasoning models may have different tool behavior",
		},
	},
	// GPT-5 - full support
	{ pattern: /^gpt-5/i, capability: NATIVE_TOOL_SUPPORT },
	// Claude models (via OpenRouter)
	{ pattern: /claude/i, capability: NATIVE_TOOL_SUPPORT },
	// Gemini models (via OpenRouter)
	{ pattern: /gemini/i, capability: NATIVE_TOOL_SUPPORT },
	// Llama models - support varies
	{
		pattern: /llama/i,
		capability: { ...NATIVE_TOOL_SUPPORT, streamingToolCalls: false },
	},
	// Mistral models
	{
		pattern: /mistral/i,
		capability: { ...NATIVE_TOOL_SUPPORT, streamingToolCalls: false },
	},
];

// A lightweight OpenAI-compatible client using fetch/SSE.
// Supports both OpenAI and local OpenAI-compatible servers (LM Studio, Ollama).
export class OpenAILLM implements BaseLLM {
	name = "openai";
	private ready = false;
	private apiKey: string;
	private baseURL: string;
	/**
	 * Context limits as reported by the provider's own `/models` listing.
	 *
	 * `WELL_KNOWN_MODELS` only recognises models someone thought to add, so every
	 * aggregator model outside that list silently fell back to a 10K window — the
	 * agent then budgeted its context against a limit an order of magnitude below
	 * the truth. OpenRouter (and most OpenAI-compatible gateways) publish
	 * `context_length` per model, which is authoritative; prefer it.
	 */
	private modelLimits = new Map<string, ModelConfig>();
	private modelLimitsLoad: Promise<void> | null = null;

	constructor(apiKey?: string, baseURL?: string) {
		this.apiKey = apiKey || "";
		this.baseURL = (baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
	}

	/**
	 * Populate {@link modelLimits} once per instance. Failures are swallowed: the
	 * pattern table and defaults below still produce a usable answer, and a token
	 * estimate is never worth failing a chat over.
	 */
	private async ensureModelLimits(): Promise<void> {
		if (this.modelLimits.size > 0) return;
		if (!this.modelLimitsLoad) {
			this.modelLimitsLoad = this.models()
				.then(() => {})
				.catch(() => {})
				.finally(() => {
					this.modelLimitsLoad = null;
				});
		}
		await this.modelLimitsLoad;
	}

	/**
	 * Resolve a model's limits, most trustworthy source first: what the provider
	 * reported, then the built-in pattern table, then null for the caller's
	 * default.
	 */
	private async resolveModelConfig(model: string): Promise<ModelConfig | null> {
		await this.ensureModelLimits();
		return this.modelLimits.get(model) ?? findModelConfig(model);
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

		// Remote OpenAI-compatible endpoints require authentication. Local servers
		// use LocalOpenAICompatibleLLM and may intentionally run without a key.
		// Rejecting the invalid configuration here prevents a delayed HTTP 401 in
		// the chat window and keeps unusable providers out of the model selector.
		if (!this.isLocalBase() && !this.apiKey) {
			throw new Error("API key is required for remote AI providers");
		}

		// Mark ready without probing the network to support offline/local cases.
		this.ready = true;
	}

	isReady(): boolean {
		return this.ready;
	}

	async getMaxModelTokens(model?: string): Promise<number> {
		if (!model) return UNKNOWN_MODEL_CONTEXT_WINDOW;

		const config = await this.resolveModelConfig(model);
		return config?.contextWindow ?? UNKNOWN_MODEL_CONTEXT_WINDOW;
	}

	async getMaxResponseTokens(model?: string): Promise<number> {
		if (!model) return UNKNOWN_MODEL_RESPONSE_TOKENS;

		const config = await this.resolveModelConfig(model);
		return config?.maxResponseTokens ?? UNKNOWN_MODEL_RESPONSE_TOKENS;
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
			for (const entry of modelsRaw) {
				const limits = readReportedLimits(entry);
				if (limits) {
					this.modelLimits.set(
						String(entry.id || entry.name || entry.model),
						limits,
					);
				}
			}
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

		const body: Record<string, unknown> = {
			model: request.model,
			messages: this.serializeMessages(request.messages),
			max_tokens: request.max_tokens,
			temperature: request.temperature,
			top_p: request.top_p,
			stop: request.stop,
			stream: false,
		};

		// Add tools if provided
		if (request.tools?.length) {
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
			headers: this.getHeaders(),
			body,
			signal: request.signal,
			label: "OpenAILLM",
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

		const response: ChatCompletionResponse = {
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

		response.usage = resolveTokenUsage(
			data?.usage,
			request.messages,
			extractResponseOutputText(response),
		);

		return response;
	}

	private async *createStreamingCompletion(
		request: ChatCompletionRequest,
	): AsyncIterableIterator<ChatCompletionChunk> {
		if (!this.ready) await this.initialize();

		const body: Record<string, unknown> = {
			model: request.model || "gpt-3.5-turbo",
			messages: this.serializeMessages(request.messages),
			max_tokens: request.max_tokens,
			temperature: request.temperature,
			top_p: request.top_p,
			stop: request.stop,
			stream: true,
			stream_options: { include_usage: true },
		};

		// Add tools if provided
		if (request.tools?.length) {
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
			headers: this.getHeaders(),
			body,
			signal: request.signal,
			label: "OpenAILLM",
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
		let completionOutput = "";
		let finalUsage = normalizeTokenUsage(undefined);

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
					if (!finalUsage) {
						finalChunk.usage = resolveTokenUsage(
							undefined,
							request.messages,
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

					// Usage-only chunk (OpenAI sends this as the last chunk when stream_options.include_usage is set)
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
									role: choice?.delta?.role as "assistant" | undefined,
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

	async getToolCapabilities(model?: string): Promise<ToolCapabilityInfo> {
		const modelId = model || "gpt-4";

		for (const { pattern, capability } of TOOL_SUPPORT_PATTERNS) {
			if (pattern.test(modelId)) {
				return capability;
			}
		}

		// Default for OpenAI: assume native support for unknown models
		return NATIVE_TOOL_SUPPORT;
	}

	async supportsTools(model?: string): Promise<boolean> {
		const capability = await this.getToolCapabilities(model);
		return capability.supported;
	}

	getInfo(): LLMInfo {
		return {
			name: this.name,
			type: "openai",
			ready: this.ready,
		};
	}
}
