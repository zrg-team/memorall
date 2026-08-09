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
import {
	checkProviderNeedsRestore,
	restoreAuthProvider,
	restoreAllProviders,
	getEncryptedProviders,
} from "@/utils/auth-provider-restore";
import { unlockAndRestoreProvidersWithPasskey } from "@/utils/provider-passkey-unlock";
import { detectSystemSpecs } from "@/main/modules/llm/utils/system-detection";

const JOB_NAMES = {
	getCurrentModel: "get-current-model",
	getAllModels: "get-all-models",
	getModelsForService: "get-models-for-service",
	getMaxModelTokens: "get-max-model-tokens",
	getMaxResponseTokens: "get-max-response-tokens",
	serveModel: "serve-model",
	unloadModel: "unload-model",
	deleteModel: "delete-model",
	createLLMService: "create-llm-service",
	chatCompletion: "chat-completion",
	cancelChatCompletion: "cancel-chat-completion",
	restoreAuthProvider: "restore-auth-provider",
	restoreAllProviders: "restore-all-providers",
	unlockAndRestoreAllProviders: "unlock-and-restore-all-providers",
	removeAuthProvider: "remove-auth-provider",
	detectSystemSpecs: "detect-system-specs",
	checkProviderNeedsRestore: "check-provider-needs-restore",
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
	serviceName?: string;
	model?: string;
}

export interface GetMaxResponseTokensPayload {
	serviceName?: string;
	model?: string;
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

export interface CancelChatCompletionPayload {
	targetJobId: string;
}

export interface RestoreAuthProviderPayload {
	provider: "openai" | "openrouter";
	passkey: string;
}

export interface RemoveAuthProviderPayload {
	provider: "openai" | "openrouter";
}

export interface CheckProviderNeedsRestorePayload {
	provider: "openai" | "openrouter";
}

export interface RestoreAllProvidersPayload {
	masterStrongPassword: string;
}

export interface UnlockAndRestoreAllProvidersPayload {
	passkey: string;
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

export interface GetMaxResponseTokensResult extends Record<string, unknown> {
	maxResponseTokens: number;
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

export interface CancelChatCompletionResult extends Record<string, unknown> {
	canceled: boolean;
}

export interface RestoreAuthProviderResult extends Record<string, unknown> {
	restored: boolean;
	provider: string;
}

export interface RemoveAuthProviderResult extends Record<string, unknown> {
	removed: boolean;
	provider: string;
}

export interface CheckProviderNeedsRestoreResult
	extends Record<string, unknown> {
	needsRestore: boolean;
	provider: string;
}

export interface RestoreAllProvidersResult extends Record<string, unknown> {
	restored: boolean;
	providers: string[];
}

export interface UnlockAndRestoreAllProvidersResult
	extends Record<string, unknown> {
	restored: boolean;
	providers: string[];
}

export interface DetectSystemSpecsPayload {
	// No payload needed
}

export interface DetectSystemSpecsResult extends Record<string, unknown> {
	specs: {
		memoryGB: number;
		cpuCores: number;
		hasWebGPU: boolean;
		gpu?: {
			vendor: string;
			renderer: string;
			estimatedVRAM?: number;
		};
		deviceCategory: "low" | "medium" | "high" | "ultra";
	};
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
		| ChatCompletionPayload
		| CancelChatCompletionPayload
		| RestoreAuthProviderPayload
		| RestoreAllProvidersPayload
		| UnlockAndRestoreAllProvidersPayload
		| RemoveAuthProviderPayload
		| GetMaxResponseTokensPayload
		| DetectSystemSpecsPayload
		| CheckProviderNeedsRestorePayload;
};

export class LLMOperationsHandler implements ProcessHandler<BaseJob> {
	private activeChatAbortControllers = new Map<string, AbortController>();
	private cancelledChatJobIds = new Set<string>();

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
			case JOB_NAMES.cancelChatCompletion:
				return await this.handleCancelChatCompletion(jobId, job, dependencies);
			case JOB_NAMES.restoreAuthProvider:
				return await this.handleRestoreAuthProvider(jobId, job, dependencies);
			case JOB_NAMES.restoreAllProviders:
				return await this.handleRestoreAllProviders(jobId, job, dependencies);
			case JOB_NAMES.unlockAndRestoreAllProviders:
				return await this.handleUnlockAndRestoreAllProviders(
					jobId,
					job,
					dependencies,
				);
			case JOB_NAMES.removeAuthProvider:
				return await this.handleRemoveAuthProvider(jobId, job, dependencies);
			case JOB_NAMES.getMaxResponseTokens:
				return await this.handleGetMaxResponseTokens(jobId, job, dependencies);
			case JOB_NAMES.detectSystemSpecs:
				return await this.handleDetectSystemSpecs(jobId, job, dependencies);
			case JOB_NAMES.checkProviderNeedsRestore:
				return await this.handleCheckProviderNeedsRestore(
					jobId,
					job,
					dependencies,
				);
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
		const { serviceName, model } = job.payload as GetMaxModelTokensPayload;

		await logger.info(`Starting get-max-model-tokens job for: ${serviceName}`, {
			jobId,
		});

		await updateJobProgress(jobId, {
			stage: `Getting max model tokens for ${serviceName}`,
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		let maxModelTokens: number;
		if (!serviceName) {
			maxModelTokens = await llmService.getMaxModelTokens(model);
		} else {
			maxModelTokens = await llmService.getMaxModelTokensFor(
				serviceName,
				model,
			);
		}

		await logger.info(`Get-max-model-tokens job completed`, {
			jobId,
			serviceName,
			maxModelTokens,
		});

		return { maxModelTokens };
	}

	private async handleGetMaxResponseTokens(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const { serviceName, model } = job.payload as GetMaxResponseTokensPayload;

		logger.info(`[getMaxResponseTokens] job started`, { jobId });

		await updateJobProgress(jobId, {
			stage: "Getting max response tokens from LLM service",
			progress: 50,
		});

		const llmService = serviceManager.getLLMService();

		if (!llmService) {
			throw new Error("LLM service not available");
		}

		// Get max response tokens from the background LLM service
		let maxResponseTokens: number;
		if (!serviceName) {
			maxResponseTokens = await llmService.getMaxResponseTokens(model);
		} else {
			maxResponseTokens = await llmService.getMaxResponseTokensFor(
				serviceName,
				model,
			);
		}

		logger.info(`[getMaxResponseTokens] job completed`, {
			jobId,
			maxResponseTokens,
		});

		return { maxResponseTokens };
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
		const abortController = new AbortController();
		const wasCancelledBeforeStart = this.cancelledChatJobIds.delete(jobId);
		this.activeChatAbortControllers.set(jobId, abortController);

		try {
			if (wasCancelledBeforeStart) {
				abortController.abort();
				throw new Error("Operation aborted");
			}

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

			// Stream chunks through job progress; only the caller's stream buffers them.
			let response;
			if (payload.request.stream) {
				await logger.info(
					`Getting streaming response for ${payload.serviceName}`,
					{ jobId },
				);

				const streamResponse = llmService.chatCompletionsFor(
					payload.serviceName,
					{
						...payload.request,
						signal: abortController.signal,
					} as ChatCompletionRequest,
				);

				await logger.info(`Got stream response, starting to iterate chunks`, {
					jobId,
				});
				let chunkCount = 0;

				for await (const chunk of streamResponse as AsyncIterableIterator<any>) {
					if (abortController.signal.aborted) {
						throw new Error("Operation aborted");
					}

					chunkCount++;
					await logger.info(`Received chunk ${chunkCount}`, { jobId });

					// Send each chunk immediately; do not retain a second copy in offscreen memory.
					await updateJobProgress(jobId, {
						stage: `Streaming token ${chunkCount}...`,
						progress: 60 + Math.min(30, chunkCount * 0.1),
						metadata: {
							chunk: chunk,
						},
					});
				}

				response = { streamed: true };
			} else {
				response = await llmService.chatCompletionsFor(
					payload.serviceName,
					{
						...payload.request,
						signal: abortController.signal,
					} as ChatCompletionRequest,
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
		} finally {
			this.activeChatAbortControllers.delete(jobId);
			this.cancelledChatJobIds.delete(jobId);
		}
	}

	private async handleCancelChatCompletion(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const payload = job.payload as CancelChatCompletionPayload;
		this.cancelledChatJobIds.add(payload.targetJobId);
		this.activeChatAbortControllers.get(payload.targetJobId)?.abort();

		await dependencies.logger.info(
			`Cancellation requested for chat-completion job: ${payload.targetJobId}`,
			{ jobId, targetJobId: payload.targetJobId },
		);

		return { canceled: true };
	}

	private async handleRestoreAuthProvider(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as RestoreAuthProviderPayload;

		await logger.info(
			`Starting restore-auth-provider job for: ${payload.provider}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Restoring ${payload.provider} authentication`,
			progress: 30,
		});

		// Restore provider in background thread (main mode)
		await restoreAuthProvider(payload.provider, payload.passkey);

		await updateJobProgress(jobId, {
			stage: `${payload.provider} authentication restored`,
			progress: 90,
		});

		await logger.info(`Restore-auth-provider job completed`, {
			jobId,
			provider: payload.provider,
		});

		return {
			restored: true,
			provider: payload.provider,
		};
	}

	private async handleRestoreAllProviders(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as RestoreAllProvidersPayload;

		await logger.info(`Starting restore-all-providers job`, { jobId });

		await updateJobProgress(jobId, {
			stage: "Restoring all provider authentications",
			progress: 20,
		});

		// Get list of encrypted providers
		const providers = await getEncryptedProviders();

		await updateJobProgress(jobId, {
			stage: `Found ${providers.length} providers to restore`,
			progress: 40,
		});

		// Restore all providers using master key
		await restoreAllProviders(payload.masterStrongPassword);

		await updateJobProgress(jobId, {
			stage: "All providers restored",
			progress: 90,
		});

		await logger.info(`Restore-all-providers job completed`, {
			jobId,
			providers,
		});

		return {
			restored: true,
			providers,
		};
	}

	private async handleUnlockAndRestoreAllProviders(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as UnlockAndRestoreAllProvidersPayload;

		await logger.info("Starting unlock-and-restore-all-providers job", {
			jobId,
		});

		await updateJobProgress(jobId, {
			stage: "Unlocking provider configurations",
			progress: 20,
		});

		const { providers } = await unlockAndRestoreProvidersWithPasskey(
			payload.passkey,
		);

		await updateJobProgress(jobId, {
			stage: `Restored ${providers.length} provider authentications`,
			progress: 50,
		});

		await updateJobProgress(jobId, {
			stage: "All providers restored",
			progress: 90,
		});

		await logger.info("Unlock-and-restore-all-providers job completed", {
			jobId,
			providers,
		});

		return {
			restored: true,
			providers,
		} satisfies UnlockAndRestoreAllProvidersResult;
	}

	private async handleRemoveAuthProvider(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as RemoveAuthProviderPayload;

		await logger.info(
			`Starting remove-auth-provider job for: ${payload.provider}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Removing ${payload.provider} authentication`,
			progress: 30,
		});

		const llmService = serviceManager.getLLMService();

		if (llmService) {
			// Remove the LLM service
			if (llmService.has(payload.provider)) {
				llmService.remove(payload.provider);
				await logger.info(
					`Removed ${payload.provider} LLM service from offscreen`,
					{ jobId },
				);
			}
		}

		await updateJobProgress(jobId, {
			stage: `${payload.provider} authentication removed`,
			progress: 90,
		});

		await logger.info(`Remove-auth-provider job completed`, {
			jobId,
			provider: payload.provider,
		});

		return {
			removed: true,
			provider: payload.provider,
		};
	}

	private async handleDetectSystemSpecs(
		jobId: string,
		_job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;

		await logger.info("Starting detect-system-specs job", { jobId });

		await updateJobProgress(jobId, {
			stage: "Detecting system specifications",
			progress: 20,
		});

		await updateJobProgress(jobId, {
			stage: "Detecting WebGPU and hardware capabilities",
			progress: 50,
		});

		const specs = await detectSystemSpecs();

		await updateJobProgress(jobId, {
			stage: "System detection complete",
			progress: 90,
		});

		await logger.info("Detect-system-specs job completed", {
			jobId,
			specs,
		});

		return { specs };
	}

	private async handleCheckProviderNeedsRestore(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as CheckProviderNeedsRestorePayload;

		await logger.info(
			`Starting check-provider-needs-restore job for: ${payload.provider}`,
			{ jobId },
		);

		await updateJobProgress(jobId, {
			stage: `Checking if ${payload.provider} needs passkey restoration`,
			progress: 50,
		});

		const needsRestore = await checkProviderNeedsRestore(payload.provider);

		await logger.info(`Check-provider-needs-restore job completed`, {
			jobId,
			provider: payload.provider,
			needsRestore,
		});

		return {
			needsRestore,
			provider: payload.provider,
		};
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
		"cancel-chat-completion": CancelChatCompletionPayload;
		"restore-auth-provider": RestoreAuthProviderPayload;
		"restore-all-providers": RestoreAllProvidersPayload;
		"unlock-and-restore-all-providers": UnlockAndRestoreAllProvidersPayload;
		"remove-auth-provider": RemoveAuthProviderPayload;
		"get-max-response-tokens": GetMaxResponseTokensPayload;
		"detect-system-specs": DetectSystemSpecsPayload;
		"check-provider-needs-restore": CheckProviderNeedsRestorePayload;
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
		"cancel-chat-completion": CancelChatCompletionResult;
		"restore-auth-provider": RestoreAuthProviderResult;
		"restore-all-providers": RestoreAllProvidersResult;
		"unlock-and-restore-all-providers": UnlockAndRestoreAllProvidersResult;
		"remove-auth-provider": RemoveAuthProviderResult;
		"get-max-response-tokens": GetMaxResponseTokensResult;
		"detect-system-specs": DetectSystemSpecsResult;
		"check-provider-needs-restore": CheckProviderNeedsRestoreResult;
	}
}
