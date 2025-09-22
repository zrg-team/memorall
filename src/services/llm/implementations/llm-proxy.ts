import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	BaseLLM,
	ModelInfo,
	ModelsResponse,
	ProgressEvent,
} from "../interfaces/base-llm";
import type { ServiceProvider } from "../interfaces/llm-service.interface";
import { LLM_DOWNLOAD_PROGRESS_EVENT } from "../constants";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "@/types/openai";
import type {
	ItemHandlerResult,
	JobProgressEvent,
} from "@/services/background-jobs/offscreen-handlers/types";

// Proxy class for LLMs that exist in background jobs
export class LLMProxy implements BaseLLM {
	private signalMap = new Map<string, AbortSignal>();

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
			const { promise } = await backgroundJob.execute(
				"get-models-for-service",
				{
					serviceName: this.name,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "completed" && result.result) {
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
		// Extract signal from request (can't serialize AbortSignal)
		const { signal, ...requestPayload } = request;
		let signalId: string | undefined;
		if (signal) {
			signalId = Math.random().toString(36).slice(2);
			this.signalMap.set(signalId, signal);

			// Clean up signal from map when aborted or completed
			signal.addEventListener("abort", () => {
				this.signalMap.delete(signalId!);
			});
		}

		if (request.stream) {
			// Use execute with stream: true to get real-time streaming
			const self = this;
			return (async function* () {
				try {
					const { stream } = await backgroundJob.execute(
						"chat-completion",
						{
							serviceName: self.name,
							request: { ...requestPayload, stream: true, signalId },
						},
						{ stream: true },
					);

					console.log("📡 Got stream, starting to iterate");

					// Stream chunks as they come from progress updates
					for await (const progressEvent of stream) {
						// If progress contains a chunk in metadata, yield it immediately
						if (progressEvent.metadata?.chunk) {
							yield progressEvent.metadata.chunk as ChatCompletionChunk;
						}

						if (progressEvent.status === "failed") {
							throw new Error(progressEvent.error || "Job failed");
						}

						if (progressEvent.status === "completed") {
							// Handle any final chunks in the result
							if (progressEvent.result && "response" in progressEvent.result) {
								const responseData = progressEvent.result as {
									response: { chunks: ChatCompletionChunk[] };
								};
								if (responseData.response?.chunks) {
									for (const chunk of responseData.response.chunks) {
										yield chunk;
									}
								}
							}
							break;
						}
					}
				} catch (error) {
					throw new Error(`Background job failed: ${error}`);
				} finally {
					// Clean up signal from map
					if (signalId) {
						self.signalMap.delete(signalId);
					}
				}
			})();
		} else {
			// Non-streaming request
			return (async () => {
				try {
					const { promise } = await backgroundJob.execute(
						"chat-completion",
						{
							serviceName: this.name,
							request: { ...requestPayload, signalId },
						},
						{ stream: false },
					);

					const result = await promise;

					if (
						result.status === "completed" &&
						result.result &&
						"response" in result.result
					) {
						const responseData = result.result as {
							response: ChatCompletionResponse;
						};
						return responseData.response;
					}
					throw new Error(result.error || "Failed to process chat completion");
				} catch (error) {
					throw new Error(`Background job failed: ${error}`);
				} finally {
					// Clean up signal from map
					if (signalId) {
						this.signalMap.delete(signalId);
					}
				}
			})();
		}
	}

	async unload(modelId: string): Promise<void> {
		try {
			const { promise } = await backgroundJob.execute(
				"unload-model",
				{
					serviceName: this.name,
					modelId,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "failed") {
				throw new Error(result.error || "Failed to unload model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async delete(modelId: string): Promise<void> {
		try {
			const { promise } = await backgroundJob.execute(
				"delete-model",
				{
					serviceName: this.name,
					modelId,
				},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "failed") {
				throw new Error(result.error || "Failed to delete model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	private emitProgressEvent(progress: ProgressEvent, stage: string): void {
		if (typeof window === "undefined") return;

		window.dispatchEvent(
			new CustomEvent(LLM_DOWNLOAD_PROGRESS_EVENT, {
				detail: {
					loaded: progress.loaded,
					total: progress.total,
					percent: progress.percent,
					text: stage,
					provider: this.llmType, // Include provider for debugging/logging if needed
				},
			}),
		);
	}

	async serve(
		modelId: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		try {
			const provider = this.llmType as ServiceProvider;
			if (onProgress) {
				// Use streaming job to capture progress for heavy operations like wllama
				const { stream } = await backgroundJob.createJob(
					"serve-model",
					{
						modelId,
						serviceName: this.name,
						provider,
					},
					{ stream: true },
				);

				let lastProgressEvent: JobProgressEvent | null = null;

				// Stream progress updates to onProgress callback and DOM events
				for await (const progressEvent of stream) {
					lastProgressEvent = progressEvent;
					if (progressEvent.progress !== undefined) {
						const percent = Math.min(100, Math.max(0, progressEvent.progress));
						const progressData = {
							loaded: percent,
							total: 100,
							percent: percent,
						};

						// Call callback if provided
						if (onProgress) {
							onProgress(progressData);
						}

						// Emit DOM event for cross-thread communication
						this.emitProgressEvent(
							progressData,
							progressEvent.stage || "Loading...",
						);
					}

					if (progressEvent.status === "failed") {
						throw new Error(progressEvent.error || "Job failed");
					}

					if (progressEvent.status === "completed") {
						break;
					}
				}
				if (
					lastProgressEvent?.status === "completed" &&
					lastProgressEvent.result &&
					isModelInfoResult(lastProgressEvent.result)
				) {
					return lastProgressEvent.result.modelInfo as ModelInfo;
				}
				if (lastProgressEvent?.status === "failed") {
					throw new Error(lastProgressEvent.error || "Failed to serve model");
				}
			} else {
				// Get final result (or fallback if no progress callback)
				const { promise } = await backgroundJob.execute(
					"serve-model",
					{
						modelId,
						serviceName: this.name,
						provider,
					},
					{ stream: false },
				);

				const result = await promise;

				if (result.status === "completed" && result.result) {
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

function isModelInfoResult(
	value: ItemHandlerResult,
): value is { modelInfo: ModelInfo } {
	return (
		!!value &&
		!Array.isArray(value) &&
		typeof value === "object" &&
		"modelInfo" in value
	);
}
