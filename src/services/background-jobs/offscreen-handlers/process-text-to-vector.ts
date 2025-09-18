import { serviceManager } from "@/services";
import type { ProcessHandler, ProcessDependencies } from "./types";

export interface TextToVectorPayload {
	text: string;
	embeddingName?: string;
}

export interface TextToVectorJob {
	id: string;
	jobType: "text-to-vector";
	status: string;
	payload: TextToVectorPayload;
	createdAt: Date;
	startedAt?: Date;
	completedAt?: Date;
	error?: string;
	[key: string]: unknown;
}

export class ProcessTextToVector implements ProcessHandler<TextToVectorJob> {
	async process(
		jobId: string,
		job: TextToVectorJob,
		dependencies: ProcessDependencies,
	): Promise<void> {
		const { logger, updateJobProgress, completeJob } = dependencies;
		const { text, embeddingName = "default" } = job.payload;

		try {
			await logger.info(`Starting text-to-vector job for embedding: ${embeddingName}`, { jobId });

			await updateJobProgress(jobId, {
				status: "processing",
				stage: "Converting text to vector",
				progress: 50,
			});

			const embeddingService = serviceManager.getEmbeddingService();

			if (!embeddingService) {
				throw new Error("Embedding service not available");
			}

			// Convert text to vector using the specified embedding
			const vector = embeddingName === "default"
				? await embeddingService.textToVector(text)
				: await embeddingService.textToVectorFor(embeddingName, text);

			await updateJobProgress(jobId, {
				status: "completed",
				stage: "Vector conversion completed",
				progress: 100,
				completedAt: new Date(),
			});

			await completeJob(jobId, {
				success: true,
				data: { vector },
			});

			await logger.info(`Text-to-vector job completed`, { jobId, vectorLength: vector.length });

		} catch (error) {
			await logger.error(`Text-to-vector job failed`, error, jobId);

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