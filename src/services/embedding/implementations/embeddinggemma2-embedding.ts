import type {
	MultimodalEmbeddingEncoder,
	MultimodalEmbeddingInput,
} from "../interfaces/multimodal-embedding";
import { WorkerEmbedding } from "./worker-embedding";
import {
	EMBEDDING_GEMMA_2_MODEL,
	EMBEDDING_GEMMA_2_DIMENSIONS,
	EMBEDDING_GEMMA_2_REVISION,
	EMBEDDING_GEMMA_2_FINGERPRINT,
} from "./embeddinggemma2-model";
export {
	EMBEDDING_GEMMA_2_MODEL,
	EMBEDDING_GEMMA_2_DIMENSIONS,
	EMBEDDING_GEMMA_2_REVISION,
} from "./embeddinggemma2-model";

interface PendingEmbedding {
	input: MultimodalEmbeddingInput;
	resolve(vector: number[]): void;
	reject(error: unknown): void;
}

/** Isolated from legacy memory embeddings: equal dimensions do not imply equal spaces. */
export class EmbeddingGemma2Encoder implements MultimodalEmbeddingEncoder {
	readonly dimensions = EMBEDDING_GEMMA_2_DIMENSIONS;
	readonly fingerprint = EMBEDDING_GEMMA_2_FINGERPRINT;
	private readonly worker = new WorkerEmbedding({
		modelName: EMBEDDING_GEMMA_2_MODEL,
		device: "auto",
		revision: EMBEDDING_GEMMA_2_REVISION,
	});
	private readonly foreground: PendingEmbedding[] = [];
	private readonly background: PendingEmbedding[] = [];
	private running = false;
	private searchStreak = 0;

	embed(input: MultimodalEmbeddingInput): Promise<number[]> {
		if (this.foreground.length + this.background.length >= 32)
			return Promise.reject(
				new Error("Embedding queue is busy. Try again shortly."),
			);
		return new Promise((resolve, reject) => {
			const queue =
				input.kind === "text" && input.query
					? this.foreground
					: this.background;
			queue.push({ input, resolve, reject });
			void this.drain();
		});
	}
	private async drain(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.foreground.length || this.background.length) {
				// Search gets the next slot, but cannot starve background work.
				const search =
					this.foreground.length > 0 &&
					(this.searchStreak < 4 || !this.background.length);
				const work = (search ? this.foreground : this.background).shift()!;
				this.searchStreak = search ? this.searchStreak + 1 : 0;
				try {
					work.resolve(await this.worker.contentToVector(work.input));
				} catch (error) {
					work.reject(error);
				}
			}
		} finally {
			this.running = false;
		}
	}
}
