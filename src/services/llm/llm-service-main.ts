import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatCompletionChunk,
} from "@/types/openai";
import { logWarn, logInfo } from "@/utils/logger";
import { eq } from "drizzle-orm";
import { serviceManager } from "@/services";
import type { BaseLLM, ProgressEvent, ModelInfo } from "./interfaces/base-llm";
import { WllamaLLM } from "./implementations/wllama-llm";
import { WebLLMLLM } from "./implementations/webllm-llm";
import { OpenAILLM } from "./implementations/openai-llm";
import { LocalOpenAICompatibleLLM } from "./implementations/local-openai-llm";
import type { ILLMService } from "./interfaces/llm-service.interface";
import { DEFAULT_SERVICES } from "./constants";
import type {
	LLMRegistry,
	LMStudioConfig,
	OllamaConfig,
	OpenAIConfig,
	WebLLMConfig,
	WllamaConfig,
} from "./interfaces/service";
import { LLMServiceCore } from "./llm-service-core";
import { LOCAL_SERVER_LLM_CONFIG_KEYS } from "@/config/local-server-llm";

export class LLMServiceMain extends LLMServiceCore implements ILLMService {
	async initialize(): Promise<void> {
		logInfo(
			"🚀 LLM service initializing in main mode - all operations available",
		);
		await super.initialize();
		await this.ensureAllServices();
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
			case "openai":
				llm = new OpenAILLM(
					(config as OpenAIConfig).apiKey,
					(config as OpenAIConfig).baseURL,
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
			this.isReadyByName(DEFAULT_SERVICES.OPENAI)
		);
	}

	async modelsFor(name: string) {
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

	async unloadFor(name: string, modelId: string): Promise<void> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		return llm.unload(modelId);
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
	): Promise<ModelInfo> {
		const llm = await this.get(name);
		if (!llm) throw new Error(`LLM "${name}" not found`);
		const llmWithServe = llm as BaseLLM & {
			serve?: (
				model: string,
				onProgress?: (progress: ProgressEvent) => void,
			) => Promise<ModelInfo>;
		};

		await this.unloadOtherServices(name);

		if (!llmWithServe.serve) {
			let existingModel: ModelInfo | undefined;
			try {
				const models = await this.modelsFor(name);
				existingModel = models.data.find((m) => m.id === model);
			} catch (error) {
				logWarn(`Failed to fetch models for ${name}:`, error);
			}

			// For serveFor, we need to get the provider from the current model or determine it
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

	async models() {
		await this.ensureAllServices();
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
	): Promise<ModelInfo> {
		if (!this.currentModel) {
			throw new Error("No current model selected");
		}

		await this.ensureAllServices();
		return this.serveFor(this.currentModel.serviceName, model, onProgress);
	}

	private async unloadOtherServices(exceptName: string): Promise<void> {
		for (const [name] of this.llms) {
			if (name === exceptName) continue;
			if (name === DEFAULT_SERVICES.OPENAI) continue;
			try {
				const models = await this.modelsFor(name);
				for (const m of models.data) {
					if (m.loaded) {
						try {
							await this.unloadFor(name, m.id);
						} catch (e) {
							logWarn(
								`Failed to unload model ${m.id} from service ${name}:`,
								e,
							);
						}
					}
				}
			} catch (e) {
				logWarn(`Failed to fetch models for service ${name}:`, e);
			}
		}
	}

	async ensureAllServices(): Promise<void> {
		// Main mode: Create all services including heavy ones
		if (!this.has(DEFAULT_SERVICES.WLLAMA)) {
			try {
				await this.create(DEFAULT_SERVICES.WLLAMA, { type: "wllama" });
			} catch (error) {
				logWarn("Failed to create Wllama service:", error);
			}
		}
		if (!this.has(DEFAULT_SERVICES.WEBLLM)) {
			try {
				await this.create(DEFAULT_SERVICES.WEBLLM, { type: "webllm" });
			} catch (error) {
				logWarn("Failed to create WebLLM service:", error);
			}
		}

		await this.restoreLocalServices();
	}

	async restoreLocalServices(): Promise<void> {
		try {
			// Main service handles local service restoration directly from storage
			const serviceConfigs = await this.loadLocalServiceConfigs();
			if (serviceConfigs) {
				await this.createLocalServicesFromConfigs(serviceConfigs);
			}
		} catch (error) {
			logWarn("Failed to restore local services from storage:", error);
		}
	}

	private async loadLocalServiceConfigs(): Promise<Record<
		string,
		{ type: string; baseURL: string; modelId?: string }
	> | null> {
		try {
			// Load configurations from database (same pattern as LocalOpenAITab)
			const configs: Record<
				string,
				{ type: string; baseURL: string; modelId?: string }
			> = {};

			// Check for LMStudio config
			try {
				const lmstudioRows = await serviceManager.databaseService.use(
					({ db, schema }) => {
						return db
							.select()
							.from(schema.configurations)
							.where(
								eq(
									schema.configurations.key,
									LOCAL_SERVER_LLM_CONFIG_KEYS.LLM_STUDIO,
								),
							);
					},
				);

				const lmstudioConfig = lmstudioRows[0];
				if (lmstudioConfig?.data?.baseUrl) {
					configs.lmstudio = {
						type: "lmstudio",
						baseURL: `${lmstudioConfig.data.baseUrl}`,
						modelId: lmstudioConfig.data.modelId
							? `${lmstudioConfig.data.modelId}`
							: undefined,
					};
					logInfo(
						"🔍 Loaded LMStudio config from database:",
						lmstudioConfig.data.baseUrl,
					);
				}
			} catch (error) {
				logWarn("Failed to load LMStudio config from database:", error);
			}

			// Check for Ollama config
			try {
				const ollamaRows = await serviceManager.databaseService.use(
					({ db, schema }) => {
						return db
							.select()
							.from(schema.configurations)
							.where(
								eq(
									schema.configurations.key,
									LOCAL_SERVER_LLM_CONFIG_KEYS.OLLAMA,
								),
							);
					},
				);

				const ollamaConfig = ollamaRows[0];
				if (ollamaConfig?.data?.baseUrl) {
					configs.ollama = {
						type: "ollama",
						baseURL: `${ollamaConfig.data.baseUrl}`,
						modelId: ollamaConfig.data.modelId
							? `${ollamaConfig.data.modelId}`
							: undefined,
					};
					logInfo(
						"🔍 Loaded Ollama config from database:",
						ollamaConfig.data.baseUrl,
					);
				}
			} catch (error) {
				logWarn("Failed to load Ollama config from database:", error);
			}

			return Object.keys(configs).length > 0 ? configs : null;
		} catch (error) {
			logWarn("Failed to load local service configs from database:", error);
			return null;
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
