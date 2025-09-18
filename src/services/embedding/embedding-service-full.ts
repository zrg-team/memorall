import type { BaseEmbedding } from "./interfaces/base-embedding";
import {
	LocalEmbedding,
	type LocalEmbeddingOptions,
} from "./implementations/local-embedding";
import { OpenAIEmbedding } from "./implementations/openai-embedding";
import {
	WorkerEmbedding,
	type WorkerEmbeddingOptions,
} from "./implementations/worker-embedding";
import { logInfo } from "@/utils/logger";
import type { IEmbeddingService } from "./interfaces/embedding-service.interface";

// Type mapping for embedding types and their configurations
interface LocalEmbeddingConfig extends LocalEmbeddingOptions {
	type: "local";
}

interface OpenAIEmbeddingConfig {
	type: "openai";
	modelName?: string;
	apiKey?: string;
	baseUrl?: string;
}

interface WorkerEmbeddingConfig extends WorkerEmbeddingOptions {
	type: "worker";
}


// Full embedding service implementation (includes heavy models)
export class EmbeddingServiceFull implements IEmbeddingService {
	private embeddings = new Map<string, BaseEmbedding>();
	private readonly defaultName = "default";
	private defaultInitialized = false;

	constructor() {}

	async initialize(): Promise<void> {
		// Full mode: Initialize with heavy models
		logInfo("🔤 Embedding service initialized in full mode");
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
				embedding = new LocalEmbedding(
					config as LocalEmbeddingConfig,
				);
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
				embedding = new WorkerEmbedding(
					config as WorkerEmbeddingConfig,
				);
				break;

			default:
				throw new Error(`Unknown embedding type: ${embeddingType}`);
		}

		// Initialize the embedding
		await embedding.initialize();

		// Register it
		this.embeddings.set(name, embedding);

		logInfo(`✅ Embedding '${name}' created and registered`);
		return embedding;
	}

	// Get embedding by name
	async get(name: string): Promise<BaseEmbedding | undefined> {
		const embedding = this.embeddings.get(name);
		if (embedding && !embedding.isReady()) {
			await embedding.initialize();
		}
		return embedding;
	}

	// Get embedding by name (throws if not found)
	async getRequired(name: string): Promise<BaseEmbedding> {
		const embedding = await this.get(name);
		if (!embedding) {
			throw new Error(
				`Embedding '${name}' not found. Available: ${this.getNames().join(", ")}`,
			);
		}
		return embedding;
	}

	// Check if embedding exists
	has(name: string): boolean {
		return this.embeddings.has(name);
	}

	// Get all embedding names
	getNames(): string[] {
		return Array.from(this.embeddings.keys());
	}

	// List all embedding names (alias for getNames to match interface)
	list(): string[] {
		return this.getNames();
	}

	// Get all embeddings
	getAll(): Map<string, BaseEmbedding> {
		return new Map(this.embeddings);
	}

	// Remove embedding
	remove(name: string): boolean {
		return this.embeddings.delete(name);
	}

	// Get embedding info
	async getInfo(name: string) {
		const embedding = await this.get(name);
		return embedding?.getInfo();
	}

	// Get all embeddings info
	async getAllInfo() {
		const info: Record<string, ReturnType<BaseEmbedding["getInfo"]>> = {};
		for (const [name, embedding] of this.embeddings.entries()) {
			if (!embedding.isReady()) {
				await embedding.initialize();
			}
			info[name] = embedding.getInfo();
		}
		return info;
	}

	// Convenience methods for common operations
	// Ensure a default embedding exists and is ready
	private async ensureDefault(): Promise<void> {
		if (this.defaultInitialized) return;
		if (!this.has(this.defaultName)) {
			// Create a sensible local default if none registered yet
			await this.create(this.defaultName, "local", {
				type: "local",
				modelName: "nomic-ai/nomic-embed-text-v1.5",
			} as LocalEmbeddingConfig);
		} else {
			// Touch to ensure readiness
			await this.get(this.defaultName);
		}
		this.defaultInitialized = true;
	}

	// Default-first helpers
	async textToVector(text: string): Promise<number[]> {
		await this.ensureDefault();
		return this.textToVectorFor(this.defaultName, text);
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		await this.ensureDefault();
		return this.textsToVectorsFor(this.defaultName, texts);
	}

	// Named helpers (like ...For in llm-service)
	async textToVectorFor(
		embeddingName: string,
		text: string,
	): Promise<number[]> {
		const embedding = await this.getRequired(embeddingName);
		return embedding.textToVector(text);
	}

	async textsToVectorsFor(
		embeddingName: string,
		texts: string[],
	): Promise<number[][]> {
		const embedding = await this.getRequired(embeddingName);
		return embedding.textsToVectors(texts);
	}
	// Status and cleanup
	isReady(): boolean {
		return this.embeddings.size > 0;
	}

	clear(): void {
		for (const [, embedding] of this.embeddings) {
			if ("destroy" in embedding) {
				const destroyFn = (embedding as { destroy?: () => void }).destroy;
				if (typeof destroyFn === "function") destroyFn.call(embedding);
			}
		}
		this.embeddings.clear();
		this.defaultInitialized = false;
	}

	destroy(): void {
		this.clear();
	}
}

// Export class for ServiceManager to instantiate
// No singleton instance - ServiceManager will create instances
