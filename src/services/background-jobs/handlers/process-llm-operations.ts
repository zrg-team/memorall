import { serviceManager } from "@/services";
import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type {
	ILLMService,
	ServiceProvider,
} from "@/services/llm/interfaces/llm-service.interface";
import type {
	ProcessHandler,
	ProcessDependencies,
	BaseJob,
	ItemHandlerResult,
} from "./types";
import { backgroundProcessFactory } from "./process-factory";
import type { ChatCompletionRequest } from "@/types/openai";

const JOB_NAMES = {
	getCurrentModel: "get-current-model",
	getAllModels: "get-all-models",
	getModelsForService: "get-models-for-service",
	getMaxModelTokens: "get-max-model-tokens",
	serveModel: "serve-model",
	unloadModel: "unload-model",
	deleteModel: "delete-model",
	createLLMService: "create-llm-service",
	chatCompletion: "chat-completion",
} as const;

export interface GetCurrentModelPayload {
	// No specific payload needed - gets models from all services
}

export interface GetAllModelsPayload {
	// No specific payload needed - gets models from all services
}

export interface GetModelsForServicePayload {
	serviceName: string;
}

export interface GetMaxModelTokensPayload {
	serviceName: string;
}

export interface ServeModelPayload {
	modelId: string;
	provider: ServiceProvider;
	serviceName?: string; // Optional when using default service name for provider
}

export interface UnloadModelPayload {
	serviceName: string;
	modelId: string;
}

export interface DeleteModelPayload {
	serviceName: string;
	modelId: string;
}

export interface CreateLLMServicePayload {
	name: string;
	llmType: string;
	config: Record<string, unknown>;
}

export interface ChatCompletionPayload {
	serviceName: string;
	request: Record<string, unknown>; // ChatCompletionRequest from @/types/openai
}

export interface GetCurrentModelResult extends Record<string, unknown> {
	modelInfo: unknown;
}

// Define result types that handlers return
export interface GetAllModelsResult extends Record<string, unknown> {
	models: { object: "list"; data: unknown[] };
}

export interface GetModelsForServiceResult extends Record<string, unknown> {
	models: { object: "list"; data: unknown[] };
}

export interface GetMaxModelTokensResult extends Record<string, unknown> {
	maxModelTokens: number;
}

export interface ServeModelResult extends Record<string, unknown> {
	modelInfo: unknown;
}

export interface UnloadModelResult extends Record<string, unknown> {
	unloaded: boolean;
	modelId: string;
	serviceName: string;
}

export interface DeleteModelResult extends Record<string, unknown> {
	deleted: boolean;
	modelId: string;
	serviceName: string;
}

export interface CreateLLMServiceResult extends Record<string, unknown> {
	serviceInfo: unknown;
}

export interface ChatCompletionResult extends Record<string, unknown> {
	response: unknown;
}

export type LLMModelsJob = BaseJob & {
	jobType: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
	payload:
		| GetCurrentModelPayload
		| GetAllModelsPayload
		| GetModelsForServicePayload
		| GetMaxModelTokensPayload
		| ServeModelPayload
		| UnloadModelPayload
		| DeleteModelPayload
		| CreateLLMServicePayload
		| ChatCompletionPayload;
};

export class LLMOperationsHandler implements ProcessHandler<BaseJob> {
	async process(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		switch (job.jobType) {
			case JOB_NAMES.getCurrentModel:
				return await this.handleGetCurrentModel(jobId, job, dependencies);
			case JOB_NAMES.getAllModels:
				return await this.handleGetAllModels(jobId, job, dependencies);
			case JOB_NAMES.getModelsForService:
				return await this.handleGetModelsForService(jobId, job, dependencies);
			case JOB_NAMES.getMaxModelTokens:
				return await this.handleGetMaxModelTokens(jobId, job, dependencies);
			case JOB_NAMES.serveModel:
				return await this.handleServeModel(jobId, job, dependencies);
			case JOB_NAMES.unloadModel:
				return await this.handleUnloadModel(jobId, job, dependencies);
			case JOB_NAMES.deleteModel:
				return await this.handleDeleteModel(jobId, job, dependencies);
			case JOB_NAMES.createLLMService:
				return await this.handleCreateLLMService(jobId, job, dependencies);
			case JOB_NAMES.chatCompletion:
				return await this.handleChatCompletion(jobId, job, dependencies);
			default:
				throw new Error(`Unknown LLM job type: ${job.jobType}`);
		}
	}

	private async handleGetCurrentModel(
		jobId: string,
		_job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;

		logger.info(`[getCurrentModel] job started`, { jobId });

		await updateJobProgress(jobId, {
			stage: "Getting current model from LLM service",
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Get current model from the background LLM service
		const modelInfo = await llmService.getCurrentModel();

		logger.info(`[getCurrentModel] job completed`, {
			jobId,
			modelInfo,
		});

		return { modelInfo };
	}

	private async handleGetAllModels(
		jobId: string,
		_job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;

		await logger.info(`Starting get-all-models job`, { jobId });

		await updateJobProgress(jobId, {
			stage: "Getting all models from LLM service",
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Get all models from the background LLM service
		const models = await llmService.models();

		await logger.info(`Get-all-models job completed`, {
			jobId,
			modelCount: models.data.length,
		});

		return { models };
	}

	private async handleGetModelsForService(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as GetModelsForServicePayload;

		await logger.info(
			`Starting get-models-for-service job for: ${payload.serviceName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Getting models for ${payload.serviceName}`,
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Get models for the specific service from the background LLM service
		const models = await llmService.modelsFor(payload.serviceName);

		await logger.info(`Get-models-for-service job completed`, {
			jobId,
			serviceName: payload.serviceName,
			modelCount: models.data.length,
		});

		return { models };
	}

	private async handleGetMaxModelTokens(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as GetMaxModelTokensPayload;

		await logger.info(
			`Starting get-max-model-tokens job for: ${payload.serviceName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Getting max model tokens for ${payload.serviceName}`,
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Get the LLM service instance
		const llm = await llmService.get(payload.serviceName);
		if (!llm) {
			throw new Error(`LLM service "${payload.serviceName}" not found`);
		}

		// Get max model tokens from the LLM instance
		const maxModelTokens = await llm.getMaxModelTokens();

		await logger.info(`Get-max-model-tokens job completed`, {
			jobId,
			serviceName: payload.serviceName,
			maxModelTokens,
		});

		return { maxModelTokens };
	}

	private async handleServeModel(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as ServeModelPayload;

		await logger.info(`Starting serve-model job for: ${payload.modelId}`, {
			jobId,
			provider: payload.provider,
			serviceName: payload.serviceName,
		});

		await updateJobProgress(jobId, {
			stage: `Checking if model ${payload.modelId} is already loaded`,
			progress: 20,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Smart serving: check if model is already loaded
		let modelInfo;

		try {
			if (!payload.provider) {
				throw new Error("Provider is required to serve a model");
			}

			if (payload.serviceName) {
				// Check specific service
				const models = await llmService.modelsFor(payload.serviceName);
				const existingModel = models.data.find(
					(m) => m.id === payload.modelId && m.loaded,
				);

				if (existingModel) {
					await logger.info(
						`Model ${payload.modelId} already loaded on ${payload.serviceName}`,
						{ jobId },
					);

					await updateJobProgress(jobId, {
						stage: "Model already loaded, using existing",
						progress: 90,
					});

					modelInfo = existingModel;
				} else {
					await updateJobProgress(jobId, {
						stage: `Loading model ${payload.modelId} on ${payload.serviceName}`,
						progress: 50,
					});

					// Serve the model on the specific service with progress callback
					modelInfo = await llmService.serveFor(
						payload.serviceName,
						payload.modelId,
						async (progress) => {
							// Forward wllama progress to job progress
							await updateJobProgress(jobId, {
								stage: `Loading model... ${progress.percent.toFixed(2)}%`,
								progress: 50 + progress.percent * 0.4, // 50% to 90%
							});
						},
					);

					await logger.info(
						`Model ${payload.modelId} loaded on ${payload.serviceName}`,
						{ jobId },
					);
				}
			} else {
				throw new Error(
					"Service name is required - cannot auto-detect service from provider",
				);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (
				llmService &&
				errorMessage.toLowerCase().includes("module is already initialized")
			) {
				const existingModel = await this.findLoadedModel(
					llmService,
					payload.modelId,
					payload.serviceName,
				);
				if (existingModel) {
					await logger.info(
						`Model ${payload.modelId} already active, reusing existing instance`,
						{ jobId },
					);
					await updateJobProgress(jobId, {
						stage: "Model already loaded, using existing",
						progress: 90,
					});
					return { modelInfo: existingModel };
				}
			}
			throw error;
		}

		return { modelInfo };
	}

	private async findLoadedModel(
		llmService: ILLMService,
		modelId: string,
		serviceName?: string,
	): Promise<ModelInfo | null> {
		const normalizedModelId = modelId.toLowerCase();

		const checkService = async (name: string): Promise<ModelInfo | null> => {
			try {
				const models = await llmService.modelsFor(name);
				const match = models.data.find(
					(model) =>
						model.loaded && model.id.toLowerCase() === normalizedModelId,
				);
				return match ?? null;
			} catch (err) {
				// Log at debug level when available; ignore errors from unavailable services
				return null;
			}
		};

		if (serviceName) {
			const match = await checkService(serviceName);
			if (match) return match;
		}

		const serviceNames = llmService.list();
		for (const name of serviceNames) {
			if (serviceName && name === serviceName) continue;
			const match = await checkService(name);
			if (match) return match;
		}

		return null;
	}

	private async handleUnloadModel(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as UnloadModelPayload;

		await logger.info(
			`Starting unload-model job for: ${payload.modelId} from ${payload.serviceName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Unloading model ${payload.modelId} from ${payload.serviceName}`,
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Unload the model from the specific service
		await llmService.unloadFor(payload.serviceName, payload.modelId);

		await logger.info(`Unload-model job completed`, {
			jobId,
			modelId: payload.modelId,
			serviceName: payload.serviceName,
		});

		return {
			unloaded: true,
			modelId: payload.modelId,
			serviceName: payload.serviceName,
		};
	}

	private async handleDeleteModel(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as DeleteModelPayload;

		await logger.info(
			`Starting delete-model job for: ${payload.modelId} from ${payload.serviceName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Deleting model ${payload.modelId} from ${payload.serviceName}`,
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Delete the model from the specific service
		await llmService.deleteModelFor(payload.serviceName, payload.modelId);

		await logger.info(`Delete-model job completed`, {
			jobId,
			modelId: payload.modelId,
			serviceName: payload.serviceName,
		});

		return {
			deleted: true,
			modelId: payload.modelId,
			serviceName: payload.serviceName,
		};
	}

	private async handleCreateLLMService(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as CreateLLMServicePayload;

		await logger.info(
			`Starting create-llm-service job for ${payload.llmType}: ${payload.name}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Checking if LLM service already exists: ${payload.name}`,
			progress: 20,
		});

		await logger.info(
			`Checking if LLM service already exists: ${payload.name}`,
			{ jobId },
		);

		const llmService = serviceManager.getLLMService();

		await logger.info(`LLM service: ${llmService}`, { jobId });

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Check if LLM service already exists
		let serviceInfo;

		if (llmService.has(payload.name)) {
			await logger.info(
				`LLM service ${payload.name} already exists, returning existing`,
				{ jobId },
			);

			await updateJobProgress(jobId, {
				stage: "LLM service already exists, using existing",
				progress: 90,
			});

			serviceInfo = llmService.getInfoFor(payload.name);
			if (!serviceInfo) {
				// If service exists but no info, create a basic info object
				serviceInfo = {
					name: payload.name,
					type: payload.llmType as "wllama" | "openai" | "custom",
					ready: true,
				};
			}
		} else {
			await updateJobProgress(jobId, {
				stage: `Creating new ${payload.llmType} LLM service: ${payload.name}`,
				progress: 50,
			});

			// Create the LLM service in the background context using the full service
			await llmService.create(payload.name, payload.config);

			await updateJobProgress(jobId, {
				stage: "New LLM service created successfully",
				progress: 90,
			});

			serviceInfo = llmService.getInfoFor(payload.name);

			await logger.info(`New LLM service created: ${payload.name}`, {
				jobId,
			});
		}

		logger.info(
			`LLM service created: ${payload.name} result ${JSON.stringify(serviceInfo)}`,
		);

		return { serviceInfo };
	}

	private async handleChatCompletion(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as ChatCompletionPayload;

		await logger.info(
			`Starting chat-completion job for service: ${payload.serviceName}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Processing chat completion via ${payload.serviceName}`,
			progress: 30,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		await updateJobProgress(jobId, {
			stage: "Generating response",
			progress: 60,
		});

		// Handle both streaming and non-streaming requests
		let response;
		if (payload.request.stream) {
			// For streaming, we should yield chunks as they come, not collect them all
			// But since background jobs can't stream back directly, we still need to collect
			// TODO: Implement proper streaming via progress updates or different mechanism
			const chunks: any[] = [];
			await logger.info(
				`Getting streaming response for ${payload.serviceName}`,
				{ jobId },
			);

			const streamResponse = llmService.chatCompletionsFor(
				payload.serviceName,
				payload.request as unknown as ChatCompletionRequest,
			);

			await logger.info(`Got stream response, starting to iterate chunks`, {
				jobId,
			});
			let chunkCount = 0;

			for await (const chunk of streamResponse as AsyncIterableIterator<any>) {
				chunkCount++;
				await logger.info(`Received chunk ${chunkCount}`, { jobId });
				chunks.push(chunk);

				// Try to send chunk via progress update for real-time streaming
				await updateJobProgress(jobId, {
					stage: `Streaming token ${chunkCount}...`,
					progress: 60 + Math.min(30, chunkCount * 0.1), // Progress from 60% to 90%
					// Include chunk in metadata for real-time streaming
					metadata: {
						chunk: chunk,
					},
				});
			}

			await logger.info(`Collected ${chunks.length} chunks total`, { jobId });
			response = { chunks };
		} else {
			// Non-streaming response
			response = await llmService.chatCompletionsFor(
				payload.serviceName,
				payload.request as unknown as ChatCompletionRequest,
			);
		}

		await updateJobProgress(jobId, {
			stage: "Chat completion finished",
			progress: 90,
		});

		await logger.info(`Chat-completion job completed`, {
			jobId,
			serviceName: payload.serviceName,
		});

		return { response };
	}
}

// Self-register the handler
backgroundProcessFactory.register({
	instance: new LLMOperationsHandler(),
	jobs: Object.values(JOB_NAMES),
});

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		"get-current-model": GetCurrentModelPayload;
		"get-all-models": GetAllModelsPayload;
		"get-models-for-service": GetModelsForServicePayload;
		"get-max-model-tokens": GetMaxModelTokensPayload;
		"serve-model": ServeModelPayload;
		"unload-model": UnloadModelPayload;
		"delete-model": DeleteModelPayload;
		"create-llm-service": CreateLLMServicePayload;
		"chat-completion": ChatCompletionPayload;
	}

	interface JobResultRegistry {
		"get-current-model": GetCurrentModelResult;
		"get-all-models": GetAllModelsResult;
		"get-models-for-service": GetModelsForServiceResult;
		"get-max-model-tokens": GetMaxModelTokensResult;
		"serve-model": ServeModelResult;
		"unload-model": UnloadModelResult;
		"delete-model": DeleteModelResult;
		"create-llm-service": CreateLLMServiceResult;
		"chat-completion": ChatCompletionResult;
	}
}
