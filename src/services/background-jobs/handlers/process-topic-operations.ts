import { logInfo, logError } from "@/utils/logger";
import { handlerRegistry } from "./handler-registry";
import type { BaseJob, ProcessHandler, ItemHandlerResult } from "./types";
import type { Topic } from "@/services/database";
import { topicService } from "@/modules/topics/services/topic-service";

const JOB_NAMES = {
	checkTopicsExist: "check-topics-exist",
	getTopics: "get-topics",
} as const;

// Define payload interfaces
export interface CheckTopicsExistPayload {
	// Empty payload for this job
}

export interface GetTopicsPayload {
	limit?: number;
}

// Define result types
export interface CheckTopicsExistResult extends Record<string, unknown> {
	hasTopics: boolean;
	topicsCount?: number;
}

export interface GetTopicsResult extends Record<string, unknown> {
	topics: Topic[];
}

export type TopicJob = BaseJob & {
	jobType: (typeof JOB_NAMES)[keyof typeof JOB_NAMES];
	payload: CheckTopicsExistPayload | GetTopicsPayload;
};

class TopicOperationsHandler implements ProcessHandler<BaseJob> {
	async process(jobId: string, job: BaseJob): Promise<ItemHandlerResult> {
		try {
			logInfo("[TOPIC_OPERATIONS_HANDLER] Processing job:", {
				jobId,
				jobType: job?.jobType,
				job,
			});

			switch (job.jobType) {
				case JOB_NAMES.checkTopicsExist:
					return this.handleCheckTopicsExist(jobId, job);
				case JOB_NAMES.getTopics:
					return this.handleGetTopics(jobId, job);
				default:
					throw new Error(`Unknown job type: ${job.jobType}`);
			}
		} catch (error) {
			logError(
				"[TOPIC_OPERATIONS_HANDLER] Failed to process topic operation:",
				error,
			);
			throw error;
		}
	}

	private async handleCheckTopicsExist(
		jobId: string,
		job: BaseJob,
	): Promise<ItemHandlerResult> {
		logInfo("[TOPIC_OPERATIONS_HANDLER] Checking if topics exist");

		const topics = await topicService.getTopics({ limit: 1 });
		const hasTopics = topics.length > 0;

		logInfo(`[TOPIC_OPERATIONS_HANDLER] Topics exist: ${hasTopics}`);

		return {
			hasTopics,
			topicsCount: topics.length,
		};
	}

	private async handleGetTopics(
		jobId: string,
		job: BaseJob,
	): Promise<ItemHandlerResult> {
		logInfo("[TOPIC_OPERATIONS_HANDLER] Getting all topics");

		const payload = job.payload as GetTopicsPayload;
		const topics = await topicService.getTopics({
			limit: payload?.limit || 100,
		});

		logInfo(`[TOPIC_OPERATIONS_HANDLER] Retrieved ${topics.length} topics`);

		return {
			topics,
		};
	}
}

// Register the handler
const handler = new TopicOperationsHandler();
handlerRegistry.register({
	instance: handler as ProcessHandler<BaseJob>,
	jobs: ["check-topics-exist", "get-topics"],
});

// Extend global registry for smart type inference
declare global {
	interface JobTypeRegistry {
		"check-topics-exist": CheckTopicsExistPayload;
		"get-topics": GetTopicsPayload;
	}

	interface JobResultRegistry {
		"check-topics-exist": CheckTopicsExistResult;
		"get-topics": GetTopicsResult;
	}
}
