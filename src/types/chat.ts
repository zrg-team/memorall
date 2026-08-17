export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type ChatRole = "user" | "assistant" | "system";

export type ToolState =
	| "input-streaming"
	| "input-available"
	| "output-available"
	| "output-error";

export type GeneratedImage = {
	base64: string;
	uint8Array: Uint8Array;
	mediaType: string;
};

// ==================== COMPLEX CONTENT ====================

import type {
	ChatCompletionContentPart,
	ChatCompletionMessageParam,
} from "./openai";

/** Text part of an OpenAI-compatible multipart message */
export interface ComplexContentPartText {
	type: "text";
	text: string;
}

/** Image part of an OpenAI-compatible multipart message */
export interface ComplexContentPartImageUrl {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "auto" | "low" | "high";
		mimeType?: string;
	};
}

export type ComplexContentPart =
	| ComplexContentPartText
	| ComplexContentPartImageUrl;

/** Stored in messages.complexContent (jsonb) when the message has multipart OpenAI-compatible content */
export type ComplexContent = ChatCompletionContentPart[];

/** Stored in messages.parts (jsonb) as canonical role-based records for one DB row */
export type MessageParts = ChatCompletionMessageParam[];

export interface ConversationContext {
	id: string;
	inProgressMessage: { id: string };
	agentFlowName?: string;
	historyBoundary?: {
		separatorId: string;
		createdAt: string;
	};
}

export type ToolExecutionStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface ToolExecutionRecord {
	id: string;
	name: string;
	status: ToolExecutionStatus;
	startedAt: string;
	endedAt?: string;
	durationMs?: number;
	inputPreview?: string;
	outputPreview?: string;
	error?: string;
	truncated?: boolean;
	/**
	 * Tool-definition metadata (MCP server, original tool name, output schema).
	 * The previews above are clipped and redacted for storage; this is what lets
	 * the UI say *what* ran rather than only dumping its output.
	 */
	toolMetadata?: Record<string, unknown>;
}

export type AssistantToolPartState = "running" | "complete" | "error";

/** Legacy UI-only tool/action part. Do not persist in messages.complexContent. */
export interface ComplexContentPartTool {
	type: "tool";
	id: string;
	name: string;
	description: string;
	metadata?: Record<string, unknown>;
	state: AssistantToolPartState;
}

/** Legacy UI-only execution part. Do not persist in messages.complexContent. */
export interface ComplexContentPartExecution {
	type: "execution";
	id: string;
	node: string;
	metadata?: Record<string, unknown>;
	state: "running" | "complete";
}

export type AssistantExecutionPart = ComplexContentPartExecution;

/** A skill selected from the mention popup — content is injected directly into the message */
export interface AttachedSkillRef {
	name: string;
	description: string;
}

/** A reference to a file already stored in the document filesystem */
export interface AttachedDocumentRef {
	/** Relative path in document filesystem (e.g. /myphoto.png) */
	path: string;
	mimeType: string;
	name: string;
	/** Document type — determines how the file is sent to the LLM */
	docType: "pdf" | "text" | "markdown" | "image" | "excel" | "other";
}
