import { logInfo, logWarn } from "@/utils/logger";
import type {
	BaseEmbedding,
	LocalEmbeddingConfig,
	OpenAIEmbeddingConfig,
	WorkerEmbeddingConfig,
} from "./interfaces/base-embedding";
import type { IEmbeddingService } from "./interfaces/embedding-service.interface";
import { LocalEmbedding } from "./implementations/local-embedding";
import { OpenAIEmbedding } from "./implementations/openai-embedding";
import { WorkerEmbedding } from "./implementations/worker-embedding";
import { EmbeddingServiceCore } from "./embedding-service-core";

export class EmbeddingServiceMain
	extends EmbeddingServiceCore
	implements IEmbeddingService
{
	async initialize(): Promise<void> {
		logInfo(
			"🔤 Embedding service initialized in main mode - all operations available",
		);
		await super.initialize();
		await this.ensureDefaultEmbedding();
	}

	// Type-safe embedding creation with proper config verification
	async create(
		name: string,
		embeddingType: string,
		config: any,
	): Promise<BaseEmbedding> {
		let embedding: BaseEmbedding;

		switch (embeddingType) {
			case "local":
				const localConfig = config as LocalEmbeddingConfig;
				embedding = new LocalEmbedding(localConfig);
				break;

			case "openai":
				const openaiConfig = config as OpenAIEmbeddingConfig;
				embedding = new OpenAIEmbedding(
					openaiConfig.modelName,
					openaiConfig.apiKey,
					openaiConfig.baseUrl,
				);
				break;

			case "worker":
				const workerConfig = config as WorkerEmbeddingConfig;
				embedding = new WorkerEmbedding(workerConfig);
				break;

			case "custom":
				throw new Error("Custom embedding implementation not yet supported");

			default:
				throw new Error(`Unknown embedding type: ${embeddingType}`);
		}

		// Initialize the embedding
		await embedding.initialize();
		this.embeddings.set(name, embedding);
		return embedding;
	}

	async get(name: string): Promise<BaseEmbedding | null | undefined> {
		let embedding = this.embeddings.get(name);
		if (embedding) {
			return embedding;
		}

		// Try to ensure default embedding if requested
		if (name === this.defaultName && !this.defaultInitialized) {
			await this.ensureDefaultEmbedding();
			embedding = this.embeddings.get(name);
		}

		return embedding || null;
	}

	protected async createDefaultEmbedding(): Promise<void> {
		// Create a local embedding by default for full capability
		try {
			await this.create(this.defaultName, "local", {
				type: "local",
				modelName: "Xenova/all-MiniLM-L6-v2",
				normalize: true,
			});
			logInfo("🔤 Created default local embedding");
		} catch (error) {
			logWarn(
				"Failed to create default local embedding, trying OpenAI:",
				String(error),
			);

			// Fallback to OpenAI embedding
			try {
				await this.create(this.defaultName, "openai", {
					type: "openai",
					modelName: "text-embedding-3-small",
				});
				logInfo("🔤 Created default OpenAI embedding as fallback");
			} catch (openaiError) {
				logWarn(
					"Failed to create default OpenAI embedding:",
					String(openaiError),
				);
				// Service can still work but won't have a default embedding
			}
		}
	}

	// Enhanced operations for main service with local processing
	async textToVector(text: string): Promise<number[]> {
		await this.ensureDefaultEmbedding();
		return super.textToVector(text);
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		await this.ensureDefaultEmbedding();
		return super.textsToVectors(texts);
	}

	async textToVectorFor(
		embeddingName: string,
		text: string,
	): Promise<number[]> {
		const embedding = await this.get(embeddingName);
		if (!embedding) {
			throw new Error(`Embedding "${embeddingName}" not found`);
		}
		return embedding.textToVector(text);
	}

	async textsToVectorsFor(
		embeddingName: string,
		texts: string[],
	): Promise<number[][]> {
		const embedding = await this.get(embeddingName);
		if (!embedding) {
			throw new Error(`Embedding "${embeddingName}" not found`);
		}
		return embedding.textsToVectors(texts);
	}
}
