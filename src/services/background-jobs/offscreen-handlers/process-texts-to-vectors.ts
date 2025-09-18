import { serviceManager } from "@/services";
import type { ProcessHandler, ProcessDependencies } from "./types";

export interface TextsToVectorsPayload {
	texts: string[];
	embeddingName?: string;
}

export interface TextsToVectorsJob {
	id: string;
	jobType: "texts-to-vectors";
	status: string;
	payload: TextsToVectorsPayload;
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	error?: string;
	[key: string]: unknown;
}

export class ProcessTextsToVectors implements ProcessHandler<TextsToVectorsJob> {
	async process(
		jobId: string,
		job: TextsToVectorsJob,
		dependencies: ProcessDependencies,
	): Promise<void> {
		const { logger, updateJobProgress, completeJob } = dependencies;
		const { texts, embeddingName = "default" } = job.payload;

		try {
			await logger.info(`Starting texts-to-vectors job for ${texts.length} texts using embedding: ${embeddingName}`, { jobId });

			await updateJobProgress(jobId, {
				status: "processing",
				stage: "Converting texts to vectors",
				progress: 25,
			});

			const embeddingService = serviceManager.getEmbeddingService();

			if (!embeddingService) {
				throw new Error("Embedding service not available");
			}

			await updateJobProgress(jobId, {
				status: "processing",
				stage: "Processing texts with embedding service",
				progress: 50,
			});

			// Convert texts to vectors using the specified embedding
			const vectors = embeddingName === "default"
				? await embeddingService.textsToVectors(texts)
				: await embeddingService.textsToVectorsFor(embeddingName, texts);

			await updateJobProgress(jobId, {
				status: "processing",
				stage: "Finalizing vector conversion",
				progress: 90,
			});

			await updateJobProgress(jobId, {
				status: "completed",
				stage: "Vector conversion completed",
				progress: 100,
				completedAt: new Date(),
			});

			await completeJob(jobId, {
				success: true,
				data: { vectors },
			});

			await logger.info(`Texts-to-vectors job completed`, {
				jobId,
				textCount: texts.length,
				vectorCount: vectors.length,
				vectorDimension: vectors[0]?.length || 0
			});

		} catch (error) {
			await logger.error(`Texts-to-vectors job failed`, error, jobId);

			await updateJobProgress(jobId, {
				status: "failed",
				stage: "Vector conversion failed",
				progress: 0,
				error: error instanceof Error ? error.message : String(error),
				completedAt: new Date(),
			});

			await completeJob(jobId, {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}