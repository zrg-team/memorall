import type { ProcessHandler, ProcessDependencies, BaseJob, ItemHandlerResult } from "./types";
import { backgroundProcessFactory } from "./process-factory";

const JOB_NAMES = {
	async: 'basic-async',
	stream: 'basic-stream'
} as const;

// Define payload interfaces for type inference
export interface BasicAsyncPayload {
	message?: string;
	delay?: number;
}

export interface BasicStreamPayload {
	steps?: number;
	interval?: number;
}

// Define result types that handlers return
export interface BasicAsyncResult extends Record<string, unknown> {
	result: string;
	message: string;
	delay: number;
}

export interface BasicStreamResult extends Record<string, unknown> {
	result: string;
	steps: number;
	interval: number;
	duration: string;
}

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		'basic-async': BasicAsyncPayload;
		'basic-stream': BasicStreamPayload;
	}

	interface JobResultRegistry {
		'basic-async': BasicAsyncResult;
		'basic-stream': BasicStreamResult;
	}
}

export type BasicJob = BaseJob & {
	jobType: typeof JOB_NAMES[keyof typeof JOB_NAMES];
	payload: BasicAsyncPayload | BasicStreamPayload;
};

export class BasicHandler implements ProcessHandler<BaseJob> {
	async process(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		switch (job.jobType) {
			case JOB_NAMES.async:
				return this.handleBasicAsync(jobId, job, dependencies);
			case JOB_NAMES.stream:
				return this.handleBasicStream(jobId, job, dependencies);
			default:
				throw new Error(`Unknown embedding job type: ${job.jobType}`);
		}
	}

	private async handleBasicAsync(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger } = dependencies;
		const payload = job.payload as BasicAsyncPayload;

		await logger.info(
			`[START] handleBasicAsync ${jobId}`,
			{ message: payload.message, delay: payload.delay }
		);

		// Use payload delay if provided
		if (payload.delay) {
			await new Promise(resolve => setTimeout(resolve, payload.delay));
		}

		return {
			result: 'async test completed',
			message: payload.message || 'default message',
			delay: payload.delay || 0
		};
	}

	private async handleBasicStream(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger, updateJobProgress } = dependencies;
		const payload = job.payload as BasicStreamPayload;
		const steps = payload.steps || 3;
		const interval = payload.interval || 1000;

		await logger.info(
			`[START] handleBasicStream ${jobId}`,
			{ steps, interval }
		);

		for (let i = 0; i < steps; i++) {
			const progress = Math.round((i / steps) * 100);
			await updateJobProgress(jobId, {
				stage: `Step ${i + 1} of ${steps}`,
				progress,
			});

			if (i < steps - 1) {
				await new Promise((resolve) => setTimeout(resolve, interval));
			}
		}

		return {
			result: 'stream test completed',
			steps,
			interval,
			duration: `${steps * interval}ms`
		};
	}
}

// Self-register the handler
backgroundProcessFactory.register({
	instance: new BasicHandler(),
	jobs: Object.values(JOB_NAMES)
});
