import { z } from "zod";
import type { ChatCompletionToolMessageParam } from "flow-core/interfaces/engine/messages";
import type { FlowRuntimeVars } from "flow-core/runtime/runtime-context";

// Activate ServiceRegistry (side-effect — enables global augmentation)
import "flow-core/interfaces/services/services";
// AllServices is the derived type — import from services.ts, not here
import type { AllServices } from "flow-core/interfaces/services/services";

/**
 * OpenAI-compatible complex tool message content.
 * For Chat Completions role:tool messages this is an array of text content
 * parts, not an application-specific wrapper object.
 */
export type ToolComplexResult = Exclude<
	ChatCompletionToolMessageParam["content"],
	string
>;

export type ToolMessageContent = ChatCompletionToolMessageParam["content"];

export interface ToolExecutionMeta {
	operationId?: string;
	sessionId?: string;
	processId?: string;
	previewId?: string;
	snapshotId?: string;
	nextCursor?: string;
	durationMs?: number;
	truncated?: boolean;
	warnings?: string[];
	[key: string]: unknown;
}

export interface ToolExecutionResult<TStructured = unknown> {
	content: ToolMessageContent;
	structuredContent?: TStructured;
	isError?: boolean;
	meta?: ToolExecutionMeta;
}

/**
 * Legacy tools may return message content directly. Rich tools return an
 * MCP-compatible envelope while the graph still emits compatible role:tool
 * message content to the model.
 */
export type ToolResultValue = ToolMessageContent | ToolExecutionResult;

export interface ToolExecutionContext<TState = unknown> {
	state: TState;
	runtime?: FlowRuntimeVars;
}

export const toolMessageContentToText = (
	content: ChatCompletionToolMessageParam["content"],
): string => {
	if (typeof content === "string") {
		return content;
	}
	return content.map((part) => part.text).join("\n");
};

export const isToolExecutionResult = (
	value: ToolResultValue,
): value is ToolExecutionResult =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	"content" in value;

const serializeStructuredContent = (value: unknown): string => {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return JSON.stringify({ error: "Tool returned non-serializable data" });
	}
};

/** Normalise a ToolResultValue to its two components. */
export const extractToolResult = (
	value: ToolResultValue,
): {
	content: ChatCompletionToolMessageParam["content"];
	contentText: string;
	structuredContent?: unknown;
	isError: boolean;
	meta?: ToolExecutionMeta;
} => {
	if (isToolExecutionResult(value)) {
		const contentText = toolMessageContentToText(value.content);
		const structuredText =
			value.structuredContent === undefined
				? undefined
				: serializeStructuredContent(value.structuredContent);
		const modelText = structuredText
			? contentText.trim() && contentText.trim() !== structuredText.trim()
				? `${contentText}\n\n${structuredText}`
				: structuredText
			: contentText;
		return {
			content: modelText,
			contentText: modelText,
			structuredContent: value.structuredContent,
			isError: value.isError ?? false,
			meta: value.meta,
		};
	}
	if (typeof value === "string") {
		return { content: value, contentText: value, isError: false };
	}
	return {
		content: value,
		contentText: toolMessageContentToText(value),
		isError: false,
	};
};

export type JsonSchema = Record<string, unknown>;

export interface JsonToolSchema {
	kind: "json-schema";
	jsonSchema: JsonSchema;
	parse: (input: unknown) => unknown;
}

export type ToolSchema = z.ZodSchema | JsonToolSchema;

export const jsonToolSchema = (
	jsonSchema: JsonSchema,
	parse: (input: unknown) => unknown = (input) => input,
): JsonToolSchema => ({
	kind: "json-schema",
	jsonSchema,
	parse,
});

export const isJsonToolSchema = (
	schema: ToolSchema,
): schema is JsonToolSchema =>
	typeof schema === "object" &&
	schema !== null &&
	"kind" in schema &&
	schema.kind === "json-schema";

export const parseToolInput = <T>(schema: ToolSchema, input: unknown): T =>
	schema.parse(input) as T;

// Base tool interface for runtime storage (no generic constraints)
export interface BaseTool {
	name: string;
	title?: string;
	description: string;
	schema: ToolSchema;
	outputSchema?: JsonSchema;
	icons?: Array<{
		src: string;
		mimeType?: string;
		sizes?: string[];
	}>;
	annotations?: {
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
	metadata?: Record<string, unknown>;
	execute: (
		input: unknown,
		context?: ToolExecutionContext,
	) => Promise<ToolResultValue>;
}

export interface ToolBinding<TName extends string = string, TConfig = unknown> {
	name: TName;
	config?: TConfig;
}

// Typed tool interface for implementation
export interface Tool<TInput> extends Omit<BaseTool, "schema" | "execute"> {
	schema: z.ZodSchema<TInput>;
	execute: (
		input: TInput,
		context?: ToolExecutionContext,
	) => Promise<ToolResultValue>;
}

// Factory function type for creating tools with services bound
export type ToolFactory<
	TInput,
	TServices = void,
	TConfig = void,
> = TServices extends void
	? TConfig extends void
		? () => Tool<TInput>
		: (services: undefined, config: TConfig) => Tool<TInput>
	: TConfig extends void
		? (services: TServices) => Tool<TInput>
		: (services: TServices, config: TConfig) => Tool<TInput>;

// ============================================================================
// Utility types for deriving combined services from tool names
// ============================================================================

// Extract the keys from a Pick<AllServices, K> type
type ServiceKeys<S> = S extends Pick<AllServices, infer K> ? K : never;

// Get the union of service keys from multiple tool names
type ToolServicesKeys<T extends readonly (keyof ToolTypeRegistry)[]> = {
	[K in T[number]]: ServiceKeys<ToolTypeRegistry[K]["services"]>;
}[T[number]];

// Combine services from tool names + optional extra keys needed by the graph
export type CombinedServices<
	T extends readonly (keyof ToolTypeRegistry)[],
	ExtraKeys extends keyof AllServices = never,
> = Pick<AllServices, ToolServicesKeys<T> | ExtraKeys>;
