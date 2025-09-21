import { logInfo, logWarn } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	BaseEmbedding,
	OpenAIEmbeddingConfig,
} from "./interfaces/base-embedding";
import type { IEmbeddingService } from "./interfaces/embedding-service.interface";
import { OpenAIEmbedding } from "./implementations/openai-embedding";
import { EmbeddingProxy } from "./implementations/embedding-proxy";
import { EmbeddingServiceCore } from "./embedding-service-core";

export class EmbeddingServiceUI
	extends EmbeddingServiceCore
	implements IEmbeddingService
{
	async initialize(): Promise<void> {
		logInfo(
			"🔤 Embedding service initialized in UI mode - heavy operations will use background jobs",
		);
		await super.initialize();
		await this.ensureDefaultEmbedding();
	}

	// Type-safe embedding creation - delegates heavy operations to background jobs
	async create(
		name: string,
		embeddingType: string,
		config: any,
	): Promise<BaseEmbedding> {
		// For lightweight services, create locally
		if (embeddingType === "openai") {
			const openaiConfig = config as OpenAIEmbeddingConfig;
			const embedding = new OpenAIEmbedding(
				openaiConfig.modelName,
				openaiConfig.apiKey,
				openaiConfig.baseUrl,
			);
			await embedding.initialize();
			this.embeddings.set(name, embedding);
			return embedding;
		}

		// For heavy services (local, worker), delegate to background jobs
		try {
			const result = await backgroundJob.execute("create-embedding", {
				name,
				embeddingType,
				config,
			});

			if (result.status === "completed" && result.result) {
				// Create a proxy object that represents the embedding created in background
				const proxyEmbedding = new EmbeddingProxy(name, embeddingType);
				this.embeddings.set(name, proxyEmbedding);
				return proxyEmbedding;
			}
			throw new Error(result.error || "Failed to create embedding");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
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

	// Heavy operations delegated to background jobs
	async textToVector(text: string): Promise<number[]> {
		try {
			const result = await backgroundJob.execute("text-to-vector", { text });
			if (result.status === "completed" && result.result) {
				return result.result.vector;
			}
			throw new Error(result.error || "Failed to convert text to vector");
		} catch (error) {
			logWarn(
				"Failed to get vector via background job, falling back to local:",
				String(error),
			);
			return super.textToVector(text);
		}
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		try {
			const result = await backgroundJob.execute("texts-to-vectors", { texts });
			if (result.status === "completed" && result.result) {
				return result.result.vectors;
			}
			throw new Error(result.error || "Failed to convert texts to vectors");
		} catch (error) {
			logWarn(
				"Failed to get vectors via background job, falling back to local:",
				String(error),
			);
			return super.textsToVectors(texts);
		}
	}

	async textToVectorFor(
		embeddingName: string,
		text: string,
	): Promise<number[]> {
		// For lightweight API services, try local first
		const embedding = await this.get(embeddingName);
		if (embedding) {
			try {
				return await embedding.textToVector(text);
			} catch (error) {
				logWarn(`Failed to get vector from ${embeddingName}:`, String(error));
			}
		}

		// Delegate to background job if local service not available
		try {
			const result = await backgroundJob.execute("text-to-vector", {
				text,
				embeddingName,
			});
			if (result.status === "completed" && result.result) {
				return result.result.vector;
			}
			throw new Error(result.error || "Failed to convert text to vector");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async textsToVectorsFor(
		embeddingName: string,
		texts: string[],
	): Promise<number[][]> {
		// For lightweight API services, try local first
		const embedding = await this.get(embeddingName);
		if (embedding) {
			try {
				return await embedding.textsToVectors(texts);
			} catch (error) {
				logWarn(`Failed to get vectors from ${embeddingName}:`, String(error));
			}
		}

		// Delegate to background job if local service not available
		try {
			const result = await backgroundJob.execute("texts-to-vectors", {
				texts,
				embeddingName,
			});
			if (result.status === "completed" && result.result) {
				return result.result.vectors;
			}
			throw new Error(result.error || "Failed to convert texts to vectors");
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	protected async createDefaultEmbedding(): Promise<void> {
		// In UI mode, we don't create a default embedding without credentials
		// Embeddings will be created on-demand when needed with proper credentials
		// This avoids API key errors during initialization
		logInfo(
			"🔤 UI mode: Default embedding will be created on-demand when needed",
		);
	}
}
