import { z } from "zod";
import type { IFlowLLMService } from "./llm";
import type { IFlowEmbeddingService } from "./embedding";
import type { IFlowDatabase } from "./database";
import type { IFlowLogger } from "./logger";
import type { IFlowFileSystem } from "./filesystem";
import type { IFlowWebBrowserService } from "./web-browser";
import type { IFlowSandboxService } from "./sandbox";
import type { IDocumentProcessor } from "./document-processor";
import type { IFlowCoAgentService } from "./co-agent";
import type { ChatCompletionToolMessageParam } from "./messages";
import type { FlowRuntimeVars } from "../runtime/runtime-context";

// All available services
export interface AllServices {
	llm: IFlowLLMService;
	embedding: IFlowEmbeddingService;
	database: IFlowDatabase;
	logger: IFlowLogger;
	sandboxContainer?: IFlowSandboxService;
	webBrowser?: IFlowWebBrowserService;
	fs?: IFlowFileSystem;
	documentProcessor?: IDocumentProcessor;
	coAgent?: IFlowCoAgentService;
}

/**
 * OpenAI-compatible complex tool message content.
 * For Chat Completions role:tool messages this is an array of text content
 * parts, not an application-specific wrapper object.
 */
export type ToolComplexResult = Exclude<
	ChatCompletionToolMessageParam["content"],
	string
>;

/**
 * Tools return exactly the content shape accepted by an OpenAI role:tool
 * message: a string or an array of text content parts.
 */
export type ToolResultValue = ChatCompletionToolMessageParam["content"];

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

/** Normalise a ToolResultValue to its two components. */
export const extractToolResult = (
	value: ToolResultValue,
): {
	content: ChatCompletionToolMessageParam["content"];
	contentText: string;
} => {
	if (typeof value === "string") {
		return { content: value, contentText: value };
	}
	return {
		content: value,
		contentText: toolMessageContentToText(value),
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
	description: string;
	schema: ToolSchema;
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
