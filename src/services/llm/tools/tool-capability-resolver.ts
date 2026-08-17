import type { ToolCapabilityInfo } from "../interfaces/tool-capability";
import {
	NO_TOOL_SUPPORT,
	PROMPT_TOOL_SUPPORT_WITH_STREAMING,
} from "../interfaces/tool-capability";

const WEBLLM_NATIVE_FUNCTION_CALLING_MODEL_IDS = new Set([
	"Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
	"Hermes-2-Pro-Llama-3-8B-q4f32_1-MLC",
	"Hermes-2-Pro-Mistral-7B-q4f16_1-MLC",
	"Hermes-3-Llama-3.1-8B-q4f32_1-MLC",
	"Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
]);

const WEBLLM_NATIVE_TOOL_SUPPORT: ToolCapabilityInfo = {
	supported: true,
	mode: "native",
	parallelCalls: false,
	streamingToolCalls: true,
	strictMode: false,
	notes:
		"Native WebLLM function calling is limited to the pinned allowlist and returns tool_calls in the terminal chunk.",
};

const WLLAMA_NATIVE_TOOL_SUPPORT: ToolCapabilityInfo = {
	supported: true,
	mode: "native",
	parallelCalls: false,
	streamingToolCalls: true,
	strictMode: false,
	notes: "Native tool calling detected from model chat template at load time.",
};

const TRANSFORMER_NATIVE_TOOL_SUPPORT: ToolCapabilityInfo = {
	supported: true,
	mode: "native",
	parallelCalls: false,
	streamingToolCalls: true,
	strictMode: false,
	notes:
		"Native Transformers.js tool calling detected from the model chat template at load time.",
};

const WLLAMA_PROMPT_TOOL_SUPPORT: ToolCapabilityInfo = {
	...PROMPT_TOOL_SUPPORT_WITH_STREAMING,
	notes:
		"Wllama uses prompt-based tool calling. Fallback for models without a tool_calls chat template.",
};

const TRANSFORMER_PROMPT_TOOL_SUPPORT: ToolCapabilityInfo = {
	...PROMPT_TOOL_SUPPORT_WITH_STREAMING,
	notes:
		"Transformers.js uses prompt-based tool calling with terminal tool_calls synthesis.",
};

const WEBLLM_PROMPT_TOOL_SUPPORT: ToolCapabilityInfo = {
	...PROMPT_TOOL_SUPPORT_WITH_STREAMING,
	notes:
		"WebLLM falls back to prompt-based tool calling when the selected model is outside the native function-calling allowlist.",
};

export function getWebLLMToolCapabilities(model?: string): ToolCapabilityInfo {
	if (model && WEBLLM_NATIVE_FUNCTION_CALLING_MODEL_IDS.has(model)) {
		return WEBLLM_NATIVE_TOOL_SUPPORT;
	}

	return WEBLLM_PROMPT_TOOL_SUPPORT;
}

export function getTransformerToolCapabilities(
	supportsNativeTools = false,
): ToolCapabilityInfo {
	return supportsNativeTools
		? TRANSFORMER_NATIVE_TOOL_SUPPORT
		: TRANSFORMER_PROMPT_TOOL_SUPPORT;
}

export function getWllamaToolCapabilities(): ToolCapabilityInfo {
	return WLLAMA_PROMPT_TOOL_SUPPORT;
}

export { WLLAMA_NATIVE_TOOL_SUPPORT };
export { TRANSFORMER_NATIVE_TOOL_SUPPORT };

/**
 * Static capability lookup, used where the caller has no loaded model to
 * inspect (notably the proxy in `llm-proxy.ts`).
 *
 * `supportsNativeTools` must be threaded in by callers that *do* know it —
 * transformer and wllama detect native support from the model's own chat
 * template at load time, and omitting it here silently downgrades those
 * models to prompt injection.
 */
export function resolveToolCapabilitiesForLLM(
	llmType: string,
	model?: string,
	supportsNativeTools = false,
): ToolCapabilityInfo {
	switch (llmType) {
		case "webllm":
			return getWebLLMToolCapabilities(model);
		case "transformer":
			return getTransformerToolCapabilities(supportsNativeTools);
		case "wllama":
			return supportsNativeTools
				? WLLAMA_NATIVE_TOOL_SUPPORT
				: getWllamaToolCapabilities();
		default:
			return NO_TOOL_SUPPORT;
	}
}

export { WEBLLM_NATIVE_FUNCTION_CALLING_MODEL_IDS };
