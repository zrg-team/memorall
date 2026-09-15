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
	ServeOptions,
} from "./interfaces/llm-service.interface";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatibleLLM } from "./implementations/local-openai-llm";
import { LLMProxy } from "./implementations/llm-proxy";
import type {
	LLMRegistry,
	LMStudioConfig,
	OllamaConfig,
	OpenAIConfig,
	OpenRouterConfig,
} from "./interfaces/service";
import { DEFAULT_SERVICES, SERVICE_TO_PROVIDER } from "./constants";
import { LLMServiceCore } from "./llm-service-core";

export class LLMServiceProxy extends LLMServiceCore implements ILLMService {
	async initialize(): Promise<void> {
		logInfo(
			"🚀 LLM service initializing in UI mode - heavy operations will use background jobs",
		);
		await super.initialize();
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

			case "openrouter":
				llm = new OpenAILLM(
					(config as OpenRouterConfig).apiKey,
					(config as OpenRouterConfig).baseURL ||
						"https://openrouter.ai/api/v1",
				) as LLMRegistry[K]["llm"];
				await llm.initialize();
				this.llms.set(name, llm);
				return llm;

			case "ollama":
				llm = new LocalOpenAICompatibleLLM(
					(config as OllamaConfig).baseURL,
					undefined,
					"ollama",
				) as LLMRegistry[K]["llm"];
				await llm.initialize();
				this.llms.set(name, llm);
				return llm;

			case "lmstudio":
				llm = new LocalOpenAICompatibleLLM(
					(config as LMStudioConfig).baseURL,
					undefined,
					"lmstudio",
				) as LLMRegistry[K]["llm"];
				await llm.initialize();
				this.llms.set(name, llm);
				return llm;

			case "wllama":
			case "webllm":
			case "transformer":
			case "transformer-media": {
				try {
					const executeResult = await backgroundJob.execute(
						"create-llm-service",
						{
							name,
							llmType: config.type,
							config,
						},
						{ stream: false },
					);

					if ("promise" in executeResult) {
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
						throw new Error(
							"Expected promise result from non-streaming execute",
						);
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

	isReady(): boolean {
		return (
			this.isReadyByName(DEFAULT_SERVICES.OPENAI) ||
			this.isReadyByName(DEFAULT_SERVICES.OPENROUTER) ||
			this.list().some((name) => this.isReadyByName(name))
		);
	}

	async models(): Promise<{ object: "list"; data: ModelInfo[] }> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		return this.modelsFor(this.currentModel.serviceName);
	}

	async modelsFor(
		name: string,
	): Promise<{ object: "list"; data: ModelInfo[] }> {
		await this.ensureOnDemandService(name);
		const llm = await this.get(name);
		if (!llm) {
			throw new Error(
				`Service "${name}" not found. Service must be registered first.`,
			);
		}

		return await llm.models();
	}
	chatCompletionsFor(
		name: string,
		request: ChatCompletionRequest,
	):
		| Promise<ChatCompletionResponse>
		| AsyncIterableIterator<ChatCompletionChunk> {
		if (!request.model) {
			request.model = this.currentModel?.modelId;
		}
		if (request.stream) {
			const self = this;
			return (async function* () {
				let llm = await self.get(name);
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

		return this.chatCompletionsFor(name, request);
	}

	// Heavy operations delegated to background jobs
	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
		options?: ServeOptions,
	): Promise<ModelInfo> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		const result = await this.serveFor(
			this.currentModel.serviceName,
			model,
			onProgress,
			options,
		);
		return result;
	}

	async serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
		options?: ServeOptions,
	): Promise<ModelInfo> {
		await this.ensureOnDemandService(name);

		// For lite services, try local first
		const llm = await this.get(name);

		if (!llm || typeof llm.serve !== "function") {
			// Some providers (OpenAI-compatible, etc.) do not require an explicit
			// serve step. Record the selection and return a best-effort model record.
			let existingModel: ModelInfo | undefined;
			try {
				const models = await this.modelsFor(name);
				existingModel = models.data.find((m) => m.id === model);
			} catch (error) {
				logWarn(`Failed to fetch models for ${name}:`, error);
			}

			await this.recordServedModel(name, model, options, existingModel);
			return (
				existingModel ?? {
					id: model,
					name: model,
					object: "model",
					created: Math.floor(Date.now() / 1000),
					owned_by: SERVICE_TO_PROVIDER[name] ?? name,
					loaded: true,
				}
			);
		}

		// Resolve the category here, where the caller's intent is known, and hand
		// it to the offscreen service so both contexts record the same slot.
		const category = this.resolveServeCategory(name, model, options);
		const serveOptions: ServeOptions = {
			...options,
			category: category ?? undefined,
		};
		await this.recordServedModel(name, model, serveOptions);

		if (llm instanceof LLMProxy) {
			return llm.serve(model, onProgress, serveOptions);
		}
		return llm.serve(model, onProgress);
	}

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) {
			throw new Error(
				`Service "${name}" not found. Service must be registered first.`,
			);
		}

		return llm.unload(modelId);
	}

	async deleteModelFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) {
			throw new Error(
				`Service "${name}" not found. Service must be registered first.`,
			);
		}

		return llm.delete(modelId);
	}

	async unload(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.unloadFor(this.currentModel.serviceName, modelId);
	}

	async deleteModel(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.deleteModelFor(this.currentModel.serviceName, modelId);
	}

	async ensureAllServices(): Promise<void> {
		// In proxy mode, we use lazy loading - services are created on-demand
		// Only restore local services and current model's service
		await this.restoreLocalServices();

		// If there's a current model, ensure its service exists
		if (this.currentModel) {
			const serviceName = this.currentModel.serviceName;
			await this.ensureOnDemandService(
				serviceName,
				"create service for current model",
			);
		}
	}

	async restoreLocalServices(): Promise<void> {
		try {
			// Use shared method from LLMServiceCore
			const serviceConfigs = await this.loadLocalServiceConfigs();
			if (serviceConfigs) {
				await this.createLocalServicesFromConfigs(serviceConfigs);
			}
		} catch (error) {
			logWarn("Failed to restore local services from database:", error);
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
