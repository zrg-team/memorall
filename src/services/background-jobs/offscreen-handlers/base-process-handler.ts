import type {
	ProcessHandler,
	ProcessDependencies,
	BaseJob,
	ItemHandlerResult,
	JobProgressUpdate,
} from "./types";

export abstract class BaseProcessHandler<TPayload = BaseJob>
	implements ProcessHandler<TPayload>
{
	protected progressHistory: JobProgressUpdate[] = [];

	abstract process(
		jobId: string,
		payload: TPayload,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult>;

	protected async addProgress(
		jobId: string,
		stage: string,
		progress: number,
		dependencies: ProcessDependencies,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		const progressUpdate: JobProgressUpdate = {
			stage,
			progress,
			timestamp: new Date(),
			metadata,
		};

		this.progressHistory.push(progressUpdate);

		await dependencies.updateJobProgress(jobId, progressUpdate);
	}

	protected createSuccessResult(result?: Record<string, unknown>): ItemHandlerResult {
		return result;
	}

	protected createErrorResult(error: unknown): never {
		const errorMessage = error instanceof Error ? error.message : String(error);
		throw new Error(errorMessage);
	}

	protected getProgressHistory(): JobProgressUpdate[] {
		return [...this.progressHistory];
	}
}
