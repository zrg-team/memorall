import { persistentLogger } from "@/services/logging/persistent-logger";
import type {
	ProcessDependencies,
	ProcessHandler,
	JobProgressUpdate,
	JobResult,
	ChromeMessage,
	BaseJob,
} from "./types";
import { RememberSaveHandler } from "./process-remember-save";
import { KnowledgeGraphHandler } from "./process-knowledge-graph";
import { RestoreLocalServicesHandler } from "./process-restore-local-services";
import { ProcessTextToVector } from "./process-text-to-vector";
import { ProcessTextsToVectors } from "./process-texts-to-vectors";

export class ProcessFactory {
	private dependencies: ProcessDependencies;

	constructor(dependencies: ProcessDependencies) {
		this.dependencies = dependencies;
	}

	createRememberSaveHandler(): ProcessHandler<BaseJob> {
		return new RememberSaveHandler(this.dependencies);
	}

	createKnowledgeGraphHandler(): ProcessHandler<BaseJob> {
		return new KnowledgeGraphHandler(this.dependencies);
	}

	createRestoreLocalServicesHandler(): ProcessHandler<BaseJob> {
		return new RestoreLocalServicesHandler(this.dependencies);
	}

	createTextToVectorHandler(): ProcessHandler<BaseJob> {
		return new ProcessTextToVector();
	}

	createTextsToVectorsHandler(): ProcessHandler<BaseJob> {
		return new ProcessTextsToVectors();
	}

	createUnifiedHandler(jobType: string): ProcessHandler<BaseJob> {
		// SINGLE UNIFIED HANDLER - same logic for all job types
		switch (jobType) {
			case "remember-save":
				return new RememberSaveHandler(this.dependencies);
			case "knowledge-graph-conversion":
				return new KnowledgeGraphHandler(this.dependencies);
			case "restore-local-services":
				return new RestoreLocalServicesHandler(this.dependencies);
			case "text-to-vector":
				return new ProcessTextToVector();
			case "texts-to-vectors":
				return new ProcessTextsToVectors();
			default:
				throw new Error(`Unknown job type: ${jobType}`);
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
