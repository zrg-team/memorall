import { persistentLogger } from "@/services/logging/persistent-logger";
import type {
	ProcessDependencies,
	ProcessHandler,
	JobProgressUpdate,
	JobResult,
	ChromeMessage,
	BaseJob,
} from "./types";
import { handlerRegistry, type HandlerRegistration } from "./handler-registry";

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
			const finalProgress: JobProgressUpdate = {
				stage: "Completed successfully",
				progress: 100,
				timestamp: new Date(),
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

			// Log result
			await this.dependencies.logger.info(
				`✅ Job completed: [${jobId}] ${job.jobType}`,
				{ jobType: job.jobType, result: handlerResult },
				"offscreen",
			);

			// Notify completion
			await this.dependencies.sendMessage({
				type: "JOB_COMPLETED",
				jobId,
				result: jobResult,
			});
		} catch (error) {
			// Handle unexpected errors
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			await this.dependencies.logger.error(
				`💥 Unexpected error in job: ${jobId}`,
				error,
				"offscreen",
			);

			const errorProgress: JobProgressUpdate = {
				stage: "Failed with error",
				progress: 100,
				timestamp: new Date(),
				metadata: { error: errorMessage },
			};
			progressHistory.push(errorProgress);

			await this.dependencies.updateJobProgress(jobId, errorProgress);

			const jobResult: JobResult = {
				status: "failed",
				progress: progressHistory,
				error: errorMessage,
			};

			await this.dependencies.completeJob(jobId, jobResult);

			await this.dependencies.sendMessage({
				type: "JOB_COMPLETED",
				jobId,
				result: jobResult,
			});
		}
	}

	static createDependencies(
		updateJobProgress: (
			jobId: string,
			progress: JobProgressUpdate,
		) => Promise<void>,
		completeJob: (jobId: string, result: JobResult) => Promise<void>,
		updateStatus: (message: string) => void,
		sendMessage: (message: ChromeMessage) => Promise<void>,
	): ProcessDependencies {
		return {
			logger: {
				info: async (
					message: string,
					data?: Record<string, unknown>,
					context?: string,
				) => {
					await persistentLogger.info(message, data, context);
				},
				error: async (message: string, error: unknown, context?: string) => {
					await persistentLogger.error(message, error, context);
				},
				warn: async (message: string, message2: string, context?: string) => {
					await persistentLogger.warn(message, message2, context);
				},
				debug: async (
					message: string,
					data?: Record<string, unknown>,
					context?: string,
				) => {
					await persistentLogger.debug(message, data, context);
				},
			},
			updateJobProgress,
			completeJob,
			updateStatus,
			sendMessage,
		};
	}
}

export const backgroundProcessFactory = ProcessFactory.getInstance();
