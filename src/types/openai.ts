// OpenAI-compatible types

// ==================== FUNCTION DEFINITION ====================

/** JSON Schema for function parameters */
export type FunctionParameters = Record<string, unknown>;

/** Function definition for tool calling */
export interface FunctionDefinition {
	/** Function name (a-z, A-Z, 0-9, underscores, dashes, max 64 chars) */
	name: string;
	/** Description of what the function does */
	description?: string;
	/** Parameters as JSON Schema object */
	parameters?: FunctionParameters;
	/** Enable strict schema adherence */
	strict?: boolean | null;
}

// ==================== TOOL DEFINITION ====================

/** Tool definition (function type) */
export interface ChatCompletionTool {
	type: "function";
	function: FunctionDefinition;
}

// ==================== TOOL CALL (Response) ====================

/** Tool call in assistant message (non-streaming) */
export interface ChatCompletionMessageToolCall {
	/** Unique ID for this tool call */
	id: string;
	/** Type of tool - currently only "function" */
	type: "function";
	/** The function called */
	function: {
		/** Name of the function */
		name: string;
		/** JSON string of arguments */
		arguments: string;
	};
}

/** Tool call delta in streaming response */
export interface ChatCompletionChunkToolCall {
	/** Index for aggregating streamed tool calls */
	index: number;
	/** Tool call ID (sent in first chunk) */
	id?: string;
	/** Type (sent in first chunk) */
	type?: "function";
	/** Function info (streamed incrementally) */
	function?: {
		name?: string;
		arguments?: string;
	};
}

// ==================== TOOL CHOICE ====================

/** Named tool choice - force specific function */
export interface ChatCompletionNamedToolChoice {
	type: "function";
	function: {
		name: string;
	};
}

/** Tool choice option */
export type ChatCompletionToolChoiceOption =
	| "none" // Don't call any tools
	| "auto" // Model decides
	| "required" // Must call a tool
	| ChatCompletionNamedToolChoice;

// ==================== CONTENT PARTS ====================

/** Text content part */
export interface ChatCompletionContentPartText {
	type: "text";
	text: string;
}

/** Image content part */
export interface ChatCompletionContentPartImage {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "auto" | "low" | "high";
		mimeType?: string;
	};
}

/** Content part union */
export type ChatCompletionContentPart =
	| ChatCompletionContentPartText
	| ChatCompletionContentPartImage;

// ==================== MESSAGE TYPES ====================

/** System message */
export interface ChatCompletionSystemMessageParam {
	role: "system";
	content: string | ChatCompletionContentPartText[];
	name?: string;
}

/** User message */
export interface ChatCompletionUserMessageParam {
	role: "user";
	content: string | ChatCompletionContentPart[];
	name?: string;
}

/** Assistant message (with optional tool_calls) */
export interface ChatCompletionAssistantMessageParam {
	role: "assistant";
	content?: string | null;
	name?: string;
	tool_calls?: ChatCompletionMessageToolCall[];
}

/** Tool result message */
export interface ChatCompletionToolMessageParam {
	role: "tool";
	content: string | ChatCompletionContentPartText[];
	tool_call_id: string;
}

/** Union of all message types */
export type ChatCompletionMessageParam =
	| ChatCompletionSystemMessageParam
	| ChatCompletionUserMessageParam
	| ChatCompletionAssistantMessageParam
	| ChatCompletionToolMessageParam;

// Backward compatible alias
export type ChatMessage = ChatCompletionMessageParam;

// ==================== REQUEST ====================

export interface ChatCompletionRequest {
	messages: ChatCompletionMessageParam[];
	model?: string;
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	stop?: string | string[];
	signal?: AbortSignal;
	// Tool-related
	tools?: ChatCompletionTool[];
	tool_choice?: ChatCompletionToolChoiceOption;
	parallel_tool_calls?: boolean;
	// Streaming options
	stream_options?: {
		include_usage?: boolean;
	};
	/**
	 * Stable key that groups requests sharing a prompt prefix so the provider
	 * routes them to the same cache (OpenAI `prompt_cache_key`; OpenRouter uses
	 * it as its sticky-routing key). Adapters derive one when it is omitted.
	 */
	prompt_cache_key?: string;
}

// ==================== USAGE ====================

/**
 * Token accounting for one completion, flattened across provider dialects.
 *
 * OpenAI and OpenRouter report cache activity under
 * `prompt_tokens_details.{cached_tokens,cache_write_tokens}`; Anthropic-style
 * gateways use `cache_read_input_tokens` / `cache_creation_input_tokens`. The
 * adapters fold all of them into the optional fields here so the rest of the
 * app reads one shape.
 */
export interface ChatCompletionUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	/** Prompt tokens the provider served from its prompt cache. */
	cached_tokens?: number;
	/** Prompt tokens the provider wrote into its cache on this request. */
	cache_write_tokens?: number;
	/** Completion tokens spent on hidden reasoning, when reported. */
	reasoning_tokens?: number;
	/** Cost in USD when the provider reports it (OpenRouter `usage.cost`). */
	cost?: number;
	/** True when no provider usage arrived and the counts were estimated locally. */
	estimated?: boolean;
}

// ==================== RESPONSE (Non-streaming) ====================

/** Finish reason */
export type ChatCompletionFinishReason =
	| "stop"
	| "length"
	| "tool_calls"
	| "content_filter"
	| null;

/** Response message */
export interface ChatCompletionMessage {
	role: "assistant";
	content: string | null;
	tool_calls?: ChatCompletionMessageToolCall[];
}

/** Response choice */
export interface ChatCompletionChoice {
	index: number;
	message: ChatCompletionMessage;
	finish_reason: ChatCompletionFinishReason;
}

export interface ChatCompletionResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage?: ChatCompletionUsage;
}

// ==================== RESPONSE (Streaming) ====================

/** Streaming delta */
export interface ChatCompletionChunkDelta {
	role?: "assistant" | "tool";
	content?: string | null;
	tool_calls?: ChatCompletionChunkToolCall[];
	tool_call_id?: string;
}

/** Streaming choice */
export interface ChatCompletionChunkChoice {
	index: number;
	delta: ChatCompletionChunkDelta;
	finish_reason: ChatCompletionFinishReason;
}

export interface ChatCompletionChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: ChatCompletionChunkChoice[];
	usage?: ChatCompletionUsage | null;
}
