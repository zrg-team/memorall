import { logWarn } from "@/utils/logger";
import type { BaseEmbedding } from "./interfaces/base-embedding";

export abstract class EmbeddingServiceCore {
	protected embeddings = new Map<string, BaseEmbedding>();
	protected readonly defaultName = "default";
	protected defaultInitialized = false;

	async initialize(): Promise<void> {
		// Base initialization - can be extended by subclasses
	}

	has(name: string): boolean {
		return this.embeddings.has(name);
	}

	list(): string[] {
		return Array.from(this.embeddings.keys());
	}

	getInfoFor(name: string) {
		const embedding = this.embeddings.get(name);
		if (!embedding) throw new Error(`Embedding "${name}" not found`);
		const info = embedding.getInfo();
		return {
			name: info.name,
			type: info.type,
			ready: embedding.isReady(),
		};
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

	remove(name: string): boolean {
		const embedding = this.embeddings.get(name);
		if (embedding && "destroy" in embedding) {
			const destroyFn = (embedding as { destroy?: () => void }).destroy;
			if (typeof destroyFn === "function") destroyFn.call(embedding);
		}
		const removed = this.embeddings.delete(name);
		if (name === this.defaultName) {
			this.defaultInitialized = false;
		}
		return removed;
	}

	isReady(): boolean {
		return this.embeddings.size > 0 || this.defaultInitialized;
	}

	isReadyByName(name: string): boolean {
		const embedding = this.embeddings.get(name);
		return embedding ? embedding.isReady() : false;
	}

	destroy(): void {
		this.clear();
	}

	getInfo() {
		const ready = this.isReady();
		return {
			name: this.defaultName,
			type: "embedding",
			ready,
		};
	}

	// Default operations that use the "default" embedding
	async textToVector(text: string): Promise<number[]> {
		return this.textToVectorFor(this.defaultName, text);
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		return this.textsToVectorsFor(this.defaultName, texts);
	}

	// Named operations - must be implemented by concrete classes
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

	protected async ensureDefaultEmbedding(): Promise<void> {
		if (this.defaultInitialized || this.has(this.defaultName)) {
			return;
		}

		try {
			await this.createDefaultEmbedding();
			this.defaultInitialized = true;
		} catch (error) {
			logWarn("Failed to create default embedding:", String(error));
			this.defaultInitialized = false;
		}
	}

	// Abstract methods that must be implemented by concrete classes
	abstract create(
		name: string,
		embeddingType: string,
		config: any,
	): Promise<BaseEmbedding>;

	abstract get(name: string): Promise<BaseEmbedding | null | undefined>;

	// Protected method to be implemented by subclasses for creating default embedding
	protected abstract createDefaultEmbedding(): Promise<void>;
}
