import { backgroundJob } from "@/services/background-jobs/background-job";
import type { BaseEmbedding } from "../interfaces/base-embedding";

// Proxy class for embeddings that exist in background jobs
export class EmbeddingProxy implements BaseEmbedding {
	public readonly dimensions: number = 0; // Will be determined from background job

	constructor(
		public readonly name: string,
		public readonly embeddingType: string,
	) {}

	async initialize(): Promise<void> {
		// Already initialized in background job
	}

	isReady(): boolean {
		// Assume ready since it was created successfully in background
		return true;
	}

	async textToVector(text: string): Promise<number[]> {
		try {
			const executeResult = await backgroundJob.execute("text-to-vector", {
				text,
				embeddingName: this.name,
			}, { stream: false });

			if ('promise' in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return result.result.vector as number[];
				}
				throw new Error(result.error || "Failed to convert text to vector");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		try {
			const executeResult = await backgroundJob.execute("texts-to-vectors", {
				texts,
				embeddingName: this.name,
			}, { stream: false });

			if ('promise' in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return result.result.vectors as number[][];
				}
				throw new Error(result.error || "Failed to convert texts to vectors");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	getInfo(): {
		name: string;
		dimensions: number;
		type: "local" | "openai" | "custom";
	} {
		return {
			name: this.name,
			dimensions: this.dimensions,
			type: this.embeddingType as "local" | "openai" | "custom",
		};
	}
}
