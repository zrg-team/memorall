import type {
	ProcessHandler,
	ProcessDependencies,
	BaseJob,
	JobResultData,
} from "./types";

export abstract class BaseProcessHandler<TPayload = BaseJob>
	implements ProcessHandler<TPayload>
{
	protected dependencies: ProcessDependencies;

	constructor(dependencies: ProcessDependencies) {
		this.dependencies = dependencies;
	}

	abstract process(
		jobId: string,
		payload: TPayload,
		dependencies: ProcessDependencies,
	): Promise<void>;

	protected async handleError(
		jobId: string,
		error: unknown,
		stage: string,
	): Promise<void> {
		const errorMessage = error instanceof Error ? error.message : String(error);

		await this.dependencies.logger.error(
			`❌ ${this.constructor.name} failed: ${jobId}`,
			error,
			"offscreen",
		);

		await this.dependencies.updateJobProgress(jobId, {
			status: "failed",
			stage: `Error during ${stage}`,
			progress: 100,
			completedAt: new Date(),
			error: errorMessage,
		});

		await this.dependencies.completeJob(jobId, {
			success: false,
			error: errorMessage,
		});

		// Notify background script about job completion
		try {
			await this.dependencies.sendMessage({ type: "JOB_COMPLETED", jobId });
		} catch (_) {}
	}

	protected async completeSuccess(
		jobId: string,
		data?: JobResultData,
	): Promise<void> {
		await this.dependencies.completeJob(jobId, {
			success: true,
			data,
		});

		await this.dependencies.logger.info(
			`✅ ${this.constructor.name} completed: ${jobId}`,
			{ data },
			"offscreen",
		);

		// Notify background script about job completion
		try {
			await this.dependencies.sendMessage({ type: "JOB_COMPLETED", jobId });
		} catch (_) {}
	}
}
