import { backgroundJob } from "@/services/background-jobs/background-job";
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
import type { JobProgressUpdate } from "@/services/background-jobs/offscreen-handlers/types";

// Proxy class for LLMs that exist in background jobs
export class LLMProxy implements BaseLLM {
	constructor(
		public readonly name: string,
		public readonly llmType: string,
	) {}

	async initialize(): Promise<void> {
		// Already initialized in background job
	}

	isReady(): boolean {
		// Assume ready since it was created successfully in background
		return true;
	}

	async models(): Promise<ModelsResponse> {
		try {
			const result = await backgroundJob.execute("get-models-for-service", {
				serviceName: this.name,
			});

			if (result.status === 'completed' && result.result) {
				return result.result.models as ModelsResponse;
			}
			throw new Error(result.error || "Failed to get models");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
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
			// For streaming, we need to handle it differently since background jobs can't stream
			// For now, convert to non-streaming and return chunks as array
			const self = this;
			return (async function* () {
				try {
					const result = await backgroundJob.execute("chat-completion", {
						serviceName: self.name,
						request: { ...request, stream: true },
					});

					if (result.status === 'completed' && result.result && "response" in result.result) {
						const responseData = result.result as {
							response: { chunks: ChatCompletionChunk[] };
						};
						if (responseData.response?.chunks) {
							// Yield each chunk from the collected chunks
							for (const chunk of responseData.response.chunks) {
								yield chunk;
							}
						}
					} else {
						throw new Error(
							result.error || "Failed to process chat completion",
						);
					}
				} catch (error) {
					throw new Error(`Background job failed: ${error}`);
				}
			})();
		} else {
			// Non-streaming request
			return (async () => {
				try {
					const result = await backgroundJob.execute("chat-completion", {
						serviceName: this.name,
						request,
					});

					if (result.status === 'completed' && result.result && "response" in result.result) {
						const responseData = result.result as {
							response: ChatCompletionResponse;
						};
						return responseData.response;
					}
					throw new Error(result.error || "Failed to process chat completion");
				} catch (error) {
					throw new Error(`Background job failed: ${error}`);
				}
			})();
		}
	}

	async unload(modelId: string): Promise<void> {
		try {
			const result = await backgroundJob.execute("unload-model", {
				serviceName: this.name,
				modelId,
			});

			if (!result.error || result.status === 'failed') {
				throw new Error(result.error || "Failed to unload model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async delete(modelId: string): Promise<void> {
		try {
			const result = await backgroundJob.execute("delete-model", {
				serviceName: this.name,
				modelId,
			});

			if (!result.error || result.status === 'failed') {
				throw new Error(result.error || "Failed to delete model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async serve?(
		modelId: string,
		onProgress?: (progress: any) => void,
	): Promise<ModelInfo> {
		try {
			if (onProgress) {
				// Use streaming job to capture progress for heavy operations like wllama
				const { stream } = await backgroundJob.createJob(
					"serve-model",
					{
						modelId,
						serviceName: this.name,
					},
					{ stream: true },
				);

				let lastProgressEvent: JobProgressUpdate | null = null;

				console.log('==============================>')
				// Stream progress updates to onProgress callback
				for await (const progressEvent of stream) {
					console.log('=========================> progressEvent', progressEvent)
					if (progressEvent.progress !== undefined) {
						onProgress({
							loaded: progressEvent.progress,
							total: 100,
							percent: progressEvent.progress,
						});
					}

					// Check if job completed with result
					if (
						progressEvent.status === "completed" &&
						progressEvent.completedAt
					) {
						// Job completed, will get result from execute call below
						lastProgressEvent = progressEvent;
						break;
					}
				}
				console.log('lastProgressEvent', lastProgressEvent)
				if (lastProgressEvent?.result && 'modelInfo' in lastProgressEvent?.result) {
					return lastProgressEvent?.result?.modelInfo as ModelInfo;
				}
			} else {
				// Get final result (or fallback if no progress callback)
				const result = await backgroundJob.execute("serve-model", {
					modelId,
					serviceName: this.name,
				});

				if (result.status === 'completed' && result.result) {
					return result.result.modelInfo as ModelInfo;
				}	
			}
			throw new Error("Failed to serve model");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	getInfo(): {
		name: string;
		type: "wllama" | "openai" | "custom";
		ready: boolean;
	} {
		return {
			name: this.name,
			type: this.llmType as "wllama" | "openai" | "custom",
			ready: this.isReady(),
		};
	}
}
