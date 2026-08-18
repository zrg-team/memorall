import { logger } from "@/utils/logger";
import type {
	ProcessDependencies,
	ProcessHandler,
	JobProgressUpdate,
	JobResult,
	BaseJob,
} from "./types";
import { handlerRegistry, type HandlerRegistration } from "./handler-registry";
import { createJobErrorMetadata, getErrorMessage } from "./error-metadata";

export class ProcessFactory {
	private static instance: ProcessFactory;
	private dependencies?: ProcessDependencies;

	private constructor() {}

	static getInstance(): ProcessFactory {
		if (!ProcessFactory.instance) {
			ProcessFactory.instance = new ProcessFactory();
		}
		return ProcessFactory.instance;
	}

	setDependencies(dependencies: ProcessDependencies): void {
		this.dependencies = dependencies;
	}

	register(registration: HandlerRegistration): void {
		handlerRegistry.register(registration);
	}

	createUnifiedHandler(jobType: string): ProcessHandler<BaseJob> {
		return handlerRegistry.getHandler(jobType);
	}

	/**
	 * Execute a job with automatic completion and error handling
	 */
	async executeJob(jobId: string, job: BaseJob): Promise<void> {
		if (!this.dependencies) {
			throw new Error(
				"ProcessFactory dependencies not set. Call setDependencies() first.",
			);
		}

		const progressHistory: JobProgressUpdate[] = [];

		try {
			const handler = this.createUnifiedHandler(job.jobType);

			// Initial progress update
			const startProgress: JobProgressUpdate = {
				stage: "Starting...",
				progress: 0,
				timestamp: new Date(),
				status: "processing",
			};
			progressHistory.push(startProgress);

			await this.dependencies.updateJobProgress(jobId, startProgress);

			// Execute the handler and get result
			const handlerResult = await handler.process(
				jobId,
				job,
				this.dependencies,
			);

			// Final progress update
			const finalTimestamp = new Date();
			const finalProgress: JobProgressUpdate = {
				stage: "Completed successfully",
				progress: 100,
				timestamp: finalTimestamp,
				completedAt: finalTimestamp,
				status: "completed",
				result: handlerResult,
			};
			progressHistory.push(finalProgress);

			await this.dependencies.updateJobProgress(jobId, finalProgress);

			// Create complete job result
			const jobResult: JobResult = {
				status: "completed",
				result: handlerResult,
				progress: progressHistory,
			};

			// Complete the job automatically
			await this.dependencies.completeJob(jobId, jobResult);

			// Log the outcome, not the payload. `handlerResult` for a chat job is the
			// whole assistant turn — content, parts, tool executions — and persisting
			// it turned every completed job into a multi-megabyte log entry.
			await this.dependencies.logger.info(
				`✅ Job completed: [${jobId}] ${job.jobType}`,
				{ jobType: job.jobType },
				"offscreen",
			);
		} catch (error) {
			// Handle unexpected errors
			const errorMessage = getErrorMessage(error);
			const errorMetadata = createJobErrorMetadata(error);

			await this.dependencies.logger.error(
				`💥 Unexpected error in job: ${jobId}`,
				error,
				"offscreen",
			);

			const errorTimestamp = new Date();
			const errorProgress: JobProgressUpdate = {
				stage: "Failed with error",
				progress: 100,
				timestamp: errorTimestamp,
				completedAt: errorTimestamp,
				status: "failed",
				error: errorMessage,
				metadata: { error: errorMetadata },
			};
			progressHistory.push(errorProgress);

			await this.dependencies.updateJobProgress(jobId, errorProgress);

			const jobResult: JobResult = {
				status: "failed",
				progress: progressHistory,
				error: errorMessage,
				result: {
					error: errorMetadata,
				},
			};

			await this.dependencies.completeJob(jobId, jobResult);
		}
	}

	static createDependencies(
		updateJobProgress: (
			jobId: string,
			progress: JobProgressUpdate,
		) => Promise<void>,
		completeJob: (jobId: string, result: JobResult) => Promise<void>,
	): ProcessDependencies {
		return {
			logger: {
				info: async (
					message: string,
					data?: Record<string, unknown>,
					context?: string,
				) => {
					await logger.info(context, "process-factory", message, data);
				},
				error: async (message: string, error: unknown, context?: string) => {
					await logger.error(context, "process-factory", message, error);
				},
				warn: async (message: string, message2: string, context?: string) => {
					await logger.warn(context, "process-factory", message, message2);
				},
				debug: async (
					message: string,
					data?: Record<string, unknown>,
					context?: string,
				) => {
					await logger.debug(context, "process-factory", message, data);
				},
			},
			updateJobProgress,
			completeJob,
		};
	}
}

export const backgroundProcessFactory = ProcessFactory.getInstance();
