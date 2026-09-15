import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import { logWarn, logInfo } from "@/utils/logger";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./interfaces/base-llm";
import { WllamaLLM } from "./implementations/wllama-llm";
import { WebLLMLLM } from "./implementations/webllm-llm";
import { TransformerLLM } from "./implementations/transformer-llm";
import { TransformerMediaLLM } from "./implementations/transformer-media-llm";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatibleLLM } from "./implementations/local-openai-llm";
import type {
	ILLMService,
	ServeOptions,
} from "./interfaces/llm-service.interface";
import { DEFAULT_SERVICES, SERVICE_TO_PROVIDER } from "./constants";
import { isResidentLocalProvider } from "./provider-registry";
import { ResidencyManager } from "./residency-manager";
import type {
	LLMRegistry,
	LMStudioConfig,
	OllamaConfig,
	OpenAIConfig,
	OpenRouterConfig,
	WebLLMConfig,
	WllamaConfig,
} from "./interfaces/service";
import { LLMServiceCore } from "./llm-service-core";

export class LLMServiceMain extends LLMServiceCore implements ILLMService {
	private isEnsuringServices = false;

	/** One browser-hosted model in memory at a time, across every runner. */
	private readonly residency = new ResidencyManager({
		list: () => this.list(),
		isResidentLocal: (name) =>
			isResidentLocalProvider(SERVICE_TO_PROVIDER[name] ?? name),
		modelsFor: async (name) => {
			const llm = this.llms.get(name);
			if (!llm) return { object: "list", data: [] };
			return llm.models();
		},
		unloadFor: (name, modelId) => this.unloadFor(name, modelId),
		isRunnerActive: (name) => this.llms.get(name)?.isReady() ?? false,
		releaseRunner: (name) => {
			// Media runners grow a fresh WASM heap per model; destroying the
			// iframe is the only way that memory is returned. Chat runners keep
			// their existing lifecycle.
			if (name !== DEFAULT_SERVICES.TRANSFORMER_MEDIA) {
				return;
			}
			const llm = this.llms.get(name) as { destroy?: () => void } | undefined;
			llm?.destroy?.();
		},
	});

	protected override leaseModel(
		serviceName: string,
		modelId: string,
	): Promise<() => void> {
		return this.residency.acquire(serviceName, modelId);
	}

	async initialize(): Promise<void> {
		logInfo(
			"🚀 LLM service initializing in main mode - all operations available",
		);
		await super.initialize();
		// Note: super.initialize() already calls ensureAllServices(), no need to call again
	}

	async create<K extends keyof LLMRegistry>(
		name: string,
		config: LLMRegistry[K]["config"],
	): Promise<LLMRegistry[K]["llm"]> {
		if (this.llms.has(name)) {
			throw new Error(`LLM with name "${name}" already exists`);
		}

		let llm: LLMRegistry[K]["llm"];

		switch (config.type) {
			case "wllama":
				llm = new WllamaLLM(
					(config as WllamaConfig).url,
				) as LLMRegistry[K]["llm"];
				break;
			case "webllm":
				llm = new WebLLMLLM(
					(config as WebLLMConfig).url,
				) as LLMRegistry[K]["llm"];
				break;
			case "transformer":
				llm = new TransformerLLM() as LLMRegistry[K]["llm"];
				break;
			case "transformer-media":
				llm = new TransformerMediaLLM() as LLMRegistry[K]["llm"];
				break;
			case "openai":
				llm = new OpenAILLM(
					(config as OpenAIConfig).apiKey,
					(config as OpenAIConfig).baseURL,
				) as LLMRegistry[K]["llm"];
				break;
			case "openrouter":
				llm = new OpenAILLM(
					(config as OpenRouterConfig).apiKey,
					(config as OpenRouterConfig).baseURL ||
						"https://openrouter.ai/api/v1",
				) as LLMRegistry[K]["llm"];
				break;
			case "ollama":
				llm = new LocalOpenAICompatibleLLM(
					(config as OllamaConfig).baseURL,
					undefined,
					"ollama",
				) as LLMRegistry[K]["llm"];
				break;
			case "lmstudio":
				llm = new LocalOpenAICompatibleLLM(
					(config as LMStudioConfig).baseURL,
					undefined,
					"lmstudio",
				) as LLMRegistry[K]["llm"];
				break;
			case "custom":
				throw new Error("Custom LLM implementation not yet supported");
			default:
				throw new Error("Unknown LLM type");
		}
		this.llms.set(name, llm);

		await llm.initialize();
		return llm;
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
			this.isReadyByName(DEFAULT_SERVICES.WLLAMA) ||
			this.isReadyByName(DEFAULT_SERVICES.WEBLLM) ||
			this.isReadyByName(DEFAULT_SERVICES.TRANSFORMER) ||
			this.isReadyByName(DEFAULT_SERVICES.OPENAI) ||
			this.isReadyByName(DEFAULT_SERVICES.OPENROUTER) ||
			this.list().some((name) => this.isReadyByName(name))
		);
	}

	async modelsFor(name: string) {
		await this.ensureOnDemandService(name);
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.models();
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
		// Every chat path - agents, cron jobs, knowledge extraction - lands here,
		// and runners lazy-load the requested model. Leasing first is what keeps
		// a speech or image model from sharing memory with it.
		const modelId = request.model ?? "";
		if (request.stream) {
			const self = this;
			return (async function* () {
				const llm = await self.get(name);
				if (!llm) throw new Error(`LLM "${name}" not found`);
				const release = await self.residency.acquire(name, modelId);
				try {
					const completion = llm.chatCompletions(
						request as ChatCompletionRequest & { stream: true },
					);
					if (
						!completion ||
						typeof completion[Symbol.asyncIterator] !== "function"
					) {
						throw new TypeError(
							`LLM "${name}" (${llm.constructor.name}) did not return an async iterable for a streaming completion`,
						);
					}

					for await (const chunk of completion) {
						yield chunk as ChatCompletionChunk;
					}
				} finally {
					release();
				}
			})();
		} else {
			return (async () => {
				const llm = await this.get(name);
				if (!llm) throw new Error(`LLM "${name}" not found`);
				const release = await this.residency.acquire(name, modelId);
				try {
					return await (llm.chatCompletions(
						request as ChatCompletionRequest & { stream?: false },
					) as Promise<ChatCompletionResponse>);
				} finally {
					release();
				}
			})();
		}
	}

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		await llm.unload(modelId);
		this.residency.forget(name, modelId);
	}

	async deleteModelFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.delete(modelId);
	}

	async serveFor(
		name: string,
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
		options?: ServeOptions,
	): Promise<ModelInfo> {
		await this.ensureOnDemandService(name);

		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);

		if (!llm.serve) {
			let existingModel: ModelInfo | undefined;
			try {
				const models = await this.modelsFor(name);
				existingModel = models.data.find((m) => m.id === model);
			} catch (error) {
				logWarn(`Failed to fetch models for ${name}:`, error);
			}

			// Switching chat to a remote or server-hosted model leaves nothing
			// local to run; free it now rather than on the runner's idle timer.
			if (
				options?.select !== false &&
				this.resolveServeCategory(name, model, options, existingModel) ===
					"chat"
			) {
				await this.residency.releaseAll();
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

		const release = await this.residency.acquire(name, model);
		try {
			const result = await llm.serve(model, onProgress);
			await this.recordServedModel(name, model, options, result);
			return result;
		} catch (error) {
			if (
				name === DEFAULT_SERVICES.TRANSFORMER &&
				this.currentModel?.serviceName === name &&
				this.currentModel?.modelId === model
			) {
				await this.clearCurrentModel();
				logWarn(
					`Cleared stale selected model after transformer load failure: ${name}/${model}`,
				);
			}
			throw error;
		} finally {
			release();
		}
	}

	async models() {
		// Note: ensureAllServices() is called during initialization, no need to call here
		const results: ModelInfo[] = [];
		try {
			const w = await this.modelsFor(DEFAULT_SERVICES.WLLAMA);
			results.push(...w.data);
		} catch (e) {
			logWarn("models(): Wllama models error", e);
		}
		try {
			const w = await this.modelsFor(DEFAULT_SERVICES.WEBLLM);
			w.data.forEach((m) => {
				if (!results.find((r) => r.id === m.id)) results.push(m);
			});
		} catch (e) {
			logWarn("models(): WebLLM models error", e);
		}
		try {
			const w = await this.modelsFor(DEFAULT_SERVICES.TRANSFORMER);
			w.data.forEach((m) => {
				if (!results.find((r) => r.id === m.id)) results.push(m);
			});
		} catch (e) {
			logWarn("models(): Transformer models error", e);
		}
		if (this.has(DEFAULT_SERVICES.OPENAI)) {
			try {
				const w = await this.modelsFor(DEFAULT_SERVICES.OPENAI);
				w.data.forEach((m) => {
					if (!results.find((r) => r.id === m.id)) results.push(m);
				});
			} catch (e) {
				logWarn("models(): OpenAI models error", e);
			}
		}
		return { object: "list", data: results } as const;
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

	async unload(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.unloadFor(this.currentModel.serviceName, modelId);
	}

	async deleteModel(modelId: string): Promise<void> {
		if (!this.currentModel) throw new Error("No current model selected");
		return this.deleteModelFor(this.currentModel.serviceName, modelId);
	}

	async serve(
		model: string,
		onProgress?: (progress: ProgressEvent) => void,
		options?: ServeOptions,
	): Promise<ModelInfo> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		// Note: ensureAllServices() is called during initialization, no need to call here
		return this.serveFor(
			this.currentModel.serviceName,
			model,
			onProgress,
			options,
		);
	}

	async ensureAllServices(): Promise<void> {
		// Prevent re-entry to avoid infinite loops
		if (this.isEnsuringServices) {
			return;
		}

		this.isEnsuringServices = true;
		try {
			// Lazy loading: Only create the service if there's a current model using it
			// This avoids creating unnecessary iframes upfront

			// Restore any saved local services (ollama, lmstudio)
			await this.restoreLocalServices();

			// If there's a current model, ensure its service exists.
			// Do not eagerly restore/load the model during startup.
			// Actual requests already carry the selected model ID and lazy-load on demand.
			// Matching proxy-mode behavior keeps offscreen initialization from blocking on model preload.
			if (this.currentModel?.modelId) {
				const serviceName = this.currentModel.serviceName;

				await this.ensureOnDemandService(
					serviceName,
					"create service for current model",
				);
			}
		} finally {
			this.isEnsuringServices = false;
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
			logWarn("Failed to restore local services from storage:", error);
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
