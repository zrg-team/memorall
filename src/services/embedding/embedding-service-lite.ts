import type { BaseEmbedding } from "./interfaces/base-embedding";
import { OpenAIEmbedding } from "./implementations/openai-embedding";
import { logInfo, logWarn } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { IEmbeddingService } from "./interfaces/embedding-service.interface";

interface OpenAIEmbeddingConfig {
	type: "openai";
	modelName?: string;
	apiKey?: string;
	baseUrl?: string;
}

export class EmbeddingServiceLite implements IEmbeddingService {
	private embeddings = new Map<string, BaseEmbedding>();

	constructor() {}

	async initialize(): Promise<void> {
		// Lite mode: No heavy model loading, use background jobs for operations
		logInfo("🔤 Embedding service initialized in lite mode (ready for background job operations)");
	}

	// Type-safe embedding creation for lite services only
	async create(
		name: string,
		embeddingType: string,
		config: any,
	): Promise<BaseEmbedding> {
		let embedding: BaseEmbedding;

		switch (embeddingType) {
			case "openai":
				const openaiConfig = config as OpenAIEmbeddingConfig;
				embedding = new OpenAIEmbedding(
					openaiConfig.modelName,
					openaiConfig.apiKey,
					openaiConfig.baseUrl,
				);
				break;

			case "custom":
				throw new Error("Custom embedding implementation not yet supported");

			default:
				throw new Error(`Unknown embedding type: ${embeddingType}`);
		}

		// Initialize the embedding
		await embedding.initialize();

		// Register it
		this.embeddings.set(name, embedding);

		logInfo(`✅ Created ${embeddingType} embedding: ${name}`);
		return embedding;
	}

	async get(name: string): Promise<BaseEmbedding | null> {
		return this.embeddings.get(name) || null;
	}

	has(name: string): boolean {
		return this.embeddings.has(name);
	}

	remove(name: string): boolean {
		const embedding = this.embeddings.get(name);
		if (embedding && "destroy" in embedding) {
			const destroyFn = (embedding as { destroy?: () => void }).destroy;
			if (typeof destroyFn === "function") destroyFn.call(embedding);
		}
		return this.embeddings.delete(name);
	}

	list(): string[] {
		return Array.from(this.embeddings.keys());
	}

	clear(): void {
		for (const [, embedding] of this.embeddings) {
			if ("destroy" in embedding) {
				const destroyFn = (embedding as { destroy?: () => void }).destroy;
				if (typeof destroyFn === "function") destroyFn.call(embedding);
			}
		}
		this.embeddings.clear();
	}


	// Default-first helpers - delegate to background jobs
	async textToVector(text: string): Promise<number[]> {
		// Always delegate to background job in lite mode
		return this.textToVectorViaBackgroundJob(text);
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		// Always delegate to background job in lite mode
		return this.textsToVectorsViaBackgroundJob(texts);
	}

	// Named helpers - try local first, then delegate
	async textToVectorFor(
		embeddingName: string,
		text: string,
	): Promise<number[]> {
		// Try local embedding first
		const embedding = await this.get(embeddingName);
		if (embedding) {
			try {
				return await embedding.textToVector(text);
			} catch (error) {
				logWarn(`Failed to use local embedding ${embeddingName}, falling back to background job:`, error);
			}
		}

		// Delegate to background job if local not available or failed
		return this.textToVectorViaBackgroundJob(text);
	}

	async textsToVectorsFor(
		embeddingName: string,
		texts: string[],
	): Promise<number[][]> {
		// Try local embedding first
		const embedding = await this.get(embeddingName);
		if (embedding) {
			try {
				return await embedding.textsToVectors(texts);
			} catch (error) {
				logWarn(`Failed to use local embedding ${embeddingName}, falling back to background job:`, error);
			}
		}

		// Delegate to background job if local not available or failed
		return this.textsToVectorsViaBackgroundJob(texts);
	}

	// Background job delegation methods
	private async textToVectorViaBackgroundJob(text: string): Promise<number[]> {
		try {
			const result = await backgroundJob.execute("text-to-vector", { text });
			if (result.success && result.data) {
				return result.data.vector as number[];
			}
			throw new Error(result.error || "Failed to get vector");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	private async textsToVectorsViaBackgroundJob(texts: string[]): Promise<number[][]> {
		try {
			const result = await backgroundJob.execute("texts-to-vectors", { texts });
			if (result.success && result.data) {
				return result.data.vectors as number[][];
			}
			throw new Error(result.error || "Failed to get vectors");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	// Status and cleanup
	isReady(): boolean {
		// In lite mode, we're always ready since we delegate to background jobs
		return true;
	}

	destroy(): void {
		this.clear();
	}
}