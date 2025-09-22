import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import { logWarn, logInfo, logError } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./interfaces/base-llm";
import type {
	ILLMService,
	ServiceProvider,
} from "./interfaces/llm-service.interface";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatLLM } from "./implementations/local-openai-llm";
import { LLMProxy } from "./implementations/llm-proxy";
import type {
	LLMRegistry,
	LMStudioConfig,
	OllamaConfig,
	OpenAIConfig,
	WllamaConfig,
	WebLLMConfig,
} from "./interfaces/service";
import { DEFAULT_SERVICES, PROVIDER_TO_SERVICE } from "./constants";
import { LLMServiceCore } from "./llm-service-core";

export class LLMServiceUI extends LLMServiceCore implements ILLMService {
	async initialize(): Promise<void> {
		logInfo(
			"🚀 LLM service initializing in UI mode - heavy operations will use background jobs",
		);
		await super.initialize();
		await this.ensureLiteServices();
	}

	protected override async createServiceForProvider(
		provider: ServiceProvider,
	): Promise<void> {
		const serviceName = PROVIDER_TO_SERVICE[provider];

		if (!this.has(serviceName)) {
			const serviceConfigs = {
				wllama: () => this.create(serviceName, { type: "wllama" } as WllamaConfig),
				webllm: () => this.create(serviceName, { type: "webllm" } as WebLLMConfig),
				openai: () => {
					// OpenAI requires user configuration - do nothing
				},
				lmstudio: () => {
					// LMStudio requires user configuration - do nothing
				},
				ollama: () => {
					// Ollama requires user configuration - do nothing
				},
			};

			const createService = serviceConfigs[provider];
			if (createService) {
				await createService();
			}
		}
	}

	async create<K extends keyof LLMRegistry>(
		name: string,
		config: LLMRegistry[K]["config"],
	): Promise<LLMRegistry[K]["llm"]> {
		if (this.llms.has(name)) {
			throw new Error(`LLM with name "${name}" already exists`);
		}

		let llm: LLMRegistry[K]["llm"];

		// For lightweight services, create locally
		switch (config.type) {
			case "openai":
				llm = new OpenAILLM(
					(config as OpenAIConfig).apiKey,
					(config as OpenAIConfig).baseURL,
				) as LLMRegistry[K]["llm"];
				await llm.initialize();
				this.llms.set(name, llm);
				return llm;

			case "ollama":
				llm = new LocalOpenAICompatLLM(
					(config as OllamaConfig).baseURL,
					undefined,
					"ollama",
				) as LLMRegistry[K]["llm"];
				await llm.initialize();
				this.llms.set(name, llm);
				return llm;

			case "lmstudio":
				llm = new LocalOpenAICompatLLM(
					(config as LMStudioConfig).baseURL,
					undefined,
					"lmstudio",
				) as LLMRegistry[K]["llm"];
				await llm.initialize();
				this.llms.set(name, llm);
				return llm;

			case "wllama":
			case "webllm": {
				try {
					const executeResult = await backgroundJob.execute("create-llm-service", {
						name,
						llmType: config.type,
						config,
					}, { stream: false });

					if ('promise' in executeResult) {
						const result = await executeResult.promise;
						logInfo(
							`📋 Background job result: status=${result.status}, hasResult=${!!result.result}`,
						);

						if (result.status === "completed" && result.result) {
							const proxyLLM = new LLMProxy(
								name,
								config.type,
							) as LLMRegistry[K]["llm"];
							this.llms.set(name, proxyLLM);
							logInfo(
								`🎯 LLMProxy created and registered for ${name}: ${!!proxyLLM}, hasServe: ${!!(proxyLLM as any).serve}`,
							);
							return proxyLLM;
						}
						logError(`❌ Background job failed for ${name}:`, result);
						throw new Error(result.error || "Failed to create LLM service");
					} else {
						throw new Error("Expected promise result from non-streaming execute");
					}
				} catch (error) {
					throw new Error(`Background job failed: ${error}`);
				}
			}

			default:
				throw new Error("Unknown LLM type");
		}
	}

	async get(name: string): Promise<BaseLLM | undefined> {
		const llm = this.llms.get(name);
		if (llm && !llm.isReady()) {
			await llm.initialize();
		}
		return llm;
	}

	async setCurrentModel(
		modelId: string,
		provider: ServiceProvider,
		serviceName: string,
	): Promise<void> {
		// Auto-create service if it doesn't exist
		if (!this.has(serviceName)) {
			try {
				await this.createServiceForProvider(provider);
				logInfo(`✅ Service ${serviceName} created successfully for provider ${provider}`);
			} catch (error) {
				logError(`❌ Failed to create service ${serviceName} for provider ${provider}:`, error);
				// If creation fails, continue anyway - the service might be created elsewhere
			}
		}

		// Call parent implementation
		await super.setCurrentModel(modelId, provider, serviceName);
	}

	isReady(): boolean {
		return (
			this.isReadyByName(DEFAULT_SERVICES.OPENAI) ||
			this.list().some((name) => this.isReadyByName(name))
		);
	}

	// Heavy operations delegated to background jobs
	async models(): Promise<{ object: "list"; data: ModelInfo[] }> {
		try {
			const executeResult = await backgroundJob.execute("get-all-models", {}, { stream: false });
			if ('promise' in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return (result.result as any).models as {
						object: "list";
						data: ModelInfo[];
					};
				}
				return { object: "list", data: [] };
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			logWarn("Failed to get models via background job:", error);
			return { object: "list", data: [] };
		}
	}

	async modelsFor(
		name: string,
	): Promise<{ object: "list"; data: ModelInfo[] }> {
		// For lite services, try local first, then delegate if needed
		const llm = await this.get(name);
		if (llm) {
			try {
				return await llm.models();
			} catch (error) {
				logWarn(`Failed to get models for ${name}:`, error);
			}
		}

		// Delegate to background job for heavy services
		try {
			const { promise } = await backgroundJob.execute("get-models-for-service", {
				serviceName: name,
			}, { stream: false });
			const result = await promise;
			if (result.status === "completed" && result.result) {
				return (result.result as any).models as {
					object: "list";
					data: ModelInfo[];
				};
			}
		} catch (error) {
			logWarn(`Failed to get models for ${name} via background job:`, error);
		}

		return { object: "list", data: [] };
	}

	chatCompletionsFor(
		name: string,
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (request.stream) {
			const self = this;
			return (async function* () {
				let llm = await self.get(name);
				if (!llm) {
					// Try to auto-create service from current model
					const currentModel = await self.getCurrentModel();
					if (currentModel && currentModel.serviceName === name) {
						try {
							await self.createServiceForProvider(currentModel.provider);
							llm = await self.get(name);
						} catch (error) {
							logError(`Failed to auto-create service ${name}:`, error);
						}
					}
				}
				if (!llm) throw new Error(`LLM "${name}" not found`);
				for await (const chunk of llm.chatCompletions(
					request as ChatCompletionRequest & { stream: true },
				)) {
					yield chunk as ChatCompletionChunk;
				}
			})();
		} else {
			return (async () => {
				let llm = await this.get(name);
				if (!llm) {
					// Try to auto-create service from current model
					const currentModel = await this.getCurrentModel();
					if (currentModel && currentModel.serviceName === name) {
						try {
							await this.createServiceForProvider(currentModel.provider);
							llm = await this.get(name);
						} catch (error) {
							logError(`Failed to auto-create service ${name}:`, error);
						}
					}
				}
				if (!llm) throw new Error(`LLM "${name}" not found`);
				return llm.chatCompletions(
					request as ChatCompletionRequest & { stream?: false },
				) as Promise<ChatCompletionResponse>;
			})();
		}
	}

	chatCompletions(
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}
		const name = this.currentModel.serviceName;

		if (!this.has(name)) {
			logWarn(`Service not found for chatCompletions:`, {
				requestedService: name,
				currentModel: this.currentModel,
				availableServices: this.list(),
			});
		}

		return this.chatCompletionsFor(name, request);
	}

	// Heavy operations delegated to background jobs
	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		const result = await this.serveFor(this.currentModel.serviceName, model, onProgress);
		return result;
	}

	async serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		// For lite services, try local first
		const llm = await this.get(name);
		const llmWithServe = llm as BaseLLM & {
			serve?: (
				model: string,
				onProgress?: (progress: ProgressEvent) => void,
			) => Promise<ModelInfo>;
		};

		if (!llmWithServe || typeof llmWithServe.serve !== "function") {
			// Some providers (OpenAI-compatible, etc.) do not require an explicit
			// serve step. Update current model and return a best-effort model record.
			let existingModel: ModelInfo | undefined;
			try {
				const models = await this.modelsFor(name);
				existingModel = models.data.find((m) => m.id === model);
			} catch (error) {
				logWarn(`Failed to fetch models for ${name}:`, error);
			}

			// For serveFor, we need to get the provider from the current model
			if (!this.currentModel) {
				throw new Error("Cannot determine provider - no current model set");
			}

			await this.setCurrentModel(model, this.currentModel.provider, name);
			return (
				existingModel ?? {
					id: model,
					name: model,
					object: "model",
					created: Math.floor(Date.now() / 1000),
					owned_by: this.currentModel.provider,
					loaded: true,
				}
			);
		}

		const result = await llmWithServe.serve(model, onProgress);
		if (!this.currentModel) {
			throw new Error("Cannot determine provider - no current model set");
		}
		await this.setCurrentModel(model, this.currentModel.provider, name);
		return result;
	}

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (llm) {
			return llm.unload(modelId);
		}

		// Delegate to background job if service not available locally
		try {
			const { promise } = await backgroundJob.execute("unload-model", {
				serviceName: name,
				modelId,
			}, { stream: false });
			const result = await promise;
			if (result.status !== "completed") {
				throw new Error(result.error || "Failed to unload model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async deleteModelFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (llm) {
			return llm.delete(modelId);
		}

		// Delegate to background job if service not available locally
		try {
			const { promise } = await backgroundJob.execute("delete-model", {
				serviceName: name,
				modelId,
			}, { stream: false });
			const result = await promise;
			if (result.status !== "completed") {
				throw new Error(result.error || "Failed to delete model");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async unload(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.unloadFor(this.currentModel.serviceName, modelId);
	}

	async deleteModel(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.deleteModelFor(this.currentModel.serviceName, modelId);
	}

	// Private helper methods
	private async ensureLiteServices(): Promise<void> {
		// Only create lightweight services (API-based)

		// Restore local services (Ollama, LMStudio) which are lightweight proxies
		await this.restoreLocalServices();
	}

	private async restoreLocalServices(): Promise<void> {
		try {
			const { promise } = await backgroundJob.execute("restore-local-services", {}, { stream: false });
			const result = await promise;
			if (
				result &&
				typeof result === "object" &&
				"success" in result &&
				result.success &&
				"data" in result &&
				result.result
			) {
				const serviceConfigs = (
					result.result as {
						serviceConfigs?: Record<string, { type: string; baseURL: string }>;
					}
				).serviceConfigs;

				if (serviceConfigs) {
					await this.createLocalServicesFromConfigs(serviceConfigs);
				}
			}
		} catch (error) {
			logWarn(
				"Failed to restore local services via background job (continuing anyway):",
				error,
			);
			// Continue without local services - they can be configured later
		}
	}

private async createLocalServicesFromConfigs(
	serviceConfigs: Record<
		string,
		{ type: string; baseURL: string; modelId?: string }
	>,
): Promise<void> {
		if (serviceConfigs.lmstudio) {
			try {
				const lmstudioConfig: LMStudioConfig = {
					type: "lmstudio",
					baseURL: serviceConfigs.lmstudio.baseURL,
				};

				if (this.has("lmstudio")) {
					this.remove("lmstudio");
				}

				await this.create("lmstudio", lmstudioConfig);
				if (serviceConfigs.lmstudio.modelId) {
					await this.setCurrentModel(
						serviceConfigs.lmstudio.modelId,
						"lmstudio",
						"lmstudio",
					);
				}
			} catch (error) {
				logWarn("Failed to create/update LMStudio service:", error);
			}
		} else {
			if (this.has("lmstudio")) {
				this.remove("lmstudio");
			}
		}

		if (serviceConfigs.ollama) {
			try {
				const ollamaConfig: OllamaConfig = {
					type: "ollama",
					baseURL: serviceConfigs.ollama.baseURL,
				};

				if (this.has("ollama")) {
					this.remove("ollama");
				}

				await this.create("ollama", ollamaConfig);
				if (serviceConfigs.ollama.modelId) {
					await this.setCurrentModel(
						serviceConfigs.ollama.modelId,
						"ollama",
						"ollama",
					);
				}
			} catch (error) {
				logWarn("Failed to create/update Ollama service:", error);
			}
		} else {
			if (this.has("ollama")) {
				this.remove("ollama");
			}
		}
	}


}
