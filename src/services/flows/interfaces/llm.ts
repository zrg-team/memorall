import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "./messages";

export interface IFlowLLMService {
	chat?: {
		completions: {
			create(
				body: ChatCompletionRequest & { stream?: false },
			): Promise<ChatCompletionResponse>;
			create(
				body: ChatCompletionRequest & { stream: true },
			): AsyncIterable<ChatCompletionChunk>;
			create(
				body: ChatCompletionRequest,
			): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk>;
		};
	};
	models?:
		| {
				list(): Promise<{
					object: "list";
					data: Array<{
						id: string;
						object: "model";
						created?: number;
						owned_by?: string;
					}>;
				}>;
		  }
		| (() => Promise<{
				object: "list";
				data: Array<{
					id: string;
					object: "model";
					created?: number;
					owned_by?: string;
				}>;
		  }>);
	isReady(): boolean;
	getCurrentModel(): Promise<{ modelId?: string; provider?: string } | null>;
	getMaxModelTokens(model?: string): Promise<number>;
	getMaxResponseTokens(model?: string): Promise<number>;
	chatCompletions(
		body: ChatCompletionRequest,
	): Promise<ChatCompletionResponse> | AsyncIterable<ChatCompletionChunk>;
}

export type ILLMService = IFlowLLMService;
export type BaseLLM = IFlowLLMService;
