import type {
	MultimodalEmbeddingEncoder,
	MultimodalEmbeddingInput,
} from "../interfaces/multimodal-embedding";
import { WorkerEmbedding } from "./worker-embedding";

export const EMBEDDING_GEMMA_2_MODEL = "onnx-community/embeddinggemma-2-ONNX";
export const EMBEDDING_GEMMA_2_DIMENSIONS = 768;
export const EMBEDDING_GEMMA_2_REVISION =
	"daa72c51243991dfcaf9f9137d2c573d8f7790c0";

/** Isolated from legacy memory embeddings: equal dimensions do not imply equal spaces. */
export class EmbeddingGemma2Encoder implements MultimodalEmbeddingEncoder {
	readonly dimensions = EMBEDDING_GEMMA_2_DIMENSIONS;
	readonly fingerprint =
		`${EMBEDDING_GEMMA_2_MODEL}@${EMBEDDING_GEMMA_2_REVISION}:q4:768:chunks-v1`;
	private readonly worker = new WorkerEmbedding({
		modelName: EMBEDDING_GEMMA_2_MODEL,
		device: "auto",
		revision: EMBEDDING_GEMMA_2_REVISION,
	});
	private queue: Promise<unknown> = Promise.resolve();

	embed(input: MultimodalEmbeddingInput): Promise<number[]> {
		// Share one model across indexing and search without concurrent initialization/inference.
		const work = this.queue.then(() => this.worker.contentToVector(input));
		this.queue = work.catch(() => undefined);
		return work;
	}
}
