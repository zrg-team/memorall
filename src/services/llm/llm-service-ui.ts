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
} from "./interfaces/service";
import { DEFAULT_SERVICES } from "./constants";
import { LLMServiceCore } from "./llm-service-core";

export class LLMServiceUI extends LLMServiceCore implements ILLMService {
	async initialize(): Promise<void> {
		logInfo(
			"🚀 LLM service initializing in UI mode - heavy operations will use background jobs",
		);
		await super.initialize();
		await this.ensureLiteServices();
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
				const progressEventName =
					config.type === "wllama" ? "wllama:progress" : "webllm:progress";
				const emitProgress = (progress: number, stage: string) => {
					if (typeof window === "undefined") return;
					const normalized = Number.isFinite(progress) ? progress : 0;
					const clamped = Math.max(0, Math.min(100, normalized));
					const stageText =
						typeof stage === "string" ? stage : String(stage ?? "");
					window.dispatchEvent(
						new CustomEvent(progressEventName as string, {
							detail: {
								loaded: clamped,
								total: 100,
								percent: clamped,
								text: stageText,
							},
						}),
					);
				};

				try {
					const result = await backgroundJob.execute(
						"create-llm-service",
						{
							name,
							llmType: config.type,
							config,
						},
					);
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
			this.list().some((name) => this.isReadyByName(name))
		);
	}

	// Heavy operations delegated to background jobs
	async models(): Promise<{ object: "list"; data: ModelInfo[] }> {
		try {
			const result = await backgroundJob.execute("get-all-models", {});
			if (result.status === "completed" && result.result) {
				return (result.result as any).models as {
					object: "list";
					data: ModelInfo[];
				};
			}
			return { object: "list", data: [] };
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
			const result = await backgroundJob.execute("get-models-for-service", {
				serviceName: name,
			});
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
				const llm = await self.get(name);
				if (!llm) throw new Error(`LLM "${name}" not found`);
				for await (const chunk of llm.chatCompletions(
					request as ChatCompletionRequest & { stream: true },
				)) {
					yield chunk as ChatCompletionChunk;
				}
			})();
		} else {
			return (async () => {
				const llm = await this.get(name);
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
		// Auto-detect which service should handle this model
		const serviceName = this.determineServiceFromModel(model);

		console.log("serve=====================>", model, serviceName);
		// Get service, create if not exists
		let service = await this.get(serviceName);

		console.log("service=====================>", service);

		if (!service) {
			// Create the service if it doesn't exist
			if (serviceName === DEFAULT_SERVICES.WLLAMA) {
				service = await this.create(serviceName, { type: "wllama" });
			} else if (serviceName === DEFAULT_SERVICES.WEBLLM) {
				service = await this.create(serviceName, { type: "webllm" });
			} else {
				throw new Error(`Unknown service type for ${serviceName}`);
			}
		}

		if (service && service.serve) {
			const result = await service.serve(model, onProgress);
			const provider = this.determineProviderFromService(serviceName);
			await this.setCurrentModel(model, provider);
			return result;
		}

		throw new Error(`Service ${serviceName} not available for model ${model}`);
	}

	async serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
	): Promise<ModelInfo> {
		// For lite services, try local first
		const llm = await this.get(name);
		if (llm && llm.serve) {
			try {
				const result = await llm.serve(model, onProgress);
				const provider = this.determineProviderFromService(name);
				await this.setCurrentModel(model, provider);
				return result;
			} catch (error) {
				logWarn(`Failed to serve ${model} on ${name}:`, error);
			}
		}

		// Delegate to background job for heavy services
		return this.serve(model, onProgress);
	}

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (llm) {
			return llm.unload(modelId);
		}

		// Delegate to background job if service not available locally
		try {
			const result = await backgroundJob.execute("unload-model", {
				serviceName: name,
				modelId,
			});
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
			const result = await backgroundJob.execute("delete-model", {
				serviceName: name,
				modelId,
			});
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
			const result = await backgroundJob.execute("restore-local-services", {});
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
		serviceConfigs: Record<string, { type: string; baseURL: string }>,
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

	private determineServiceFromModel(modelId: string): string {
		// Determine service name from model ID - maps to DEFAULT_SERVICES
		if (modelId.includes("/") && modelId.includes(".gguf")) {
			return DEFAULT_SERVICES.WLLAMA; // "wllama" for GGUF files with repo/filename format
		}
		if (
			modelId.includes("llama") ||
			modelId.includes("vicuna") ||
			modelId.includes("gguf")
		) {
			return DEFAULT_SERVICES.WLLAMA;
		}
		if (!modelId.includes("/") && !modelId.includes(".gguf")) {
			return DEFAULT_SERVICES.WEBLLM; // WebLLM for simple model names
		}
		return DEFAULT_SERVICES.WLLAMA; // Default to wllama for complex models
	}

	private determineProviderFromService(serviceName: string): ServiceProvider {
		if (serviceName === "openai") return "openai";
		if (serviceName === "ollama") return "ollama";
		if (serviceName === "lmstudio") return "lmstudio";
		if (serviceName === "wllama") return "wllama";
		if (serviceName === "webllm") return "webllm";
		return "openai"; // Default fallback
	}
}
