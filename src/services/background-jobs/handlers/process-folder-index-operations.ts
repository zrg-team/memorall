import {
	FOLDER_INDEX_OPERATION_JOB_NAME,
	type FolderIndexOperationJobPayload,
	type FolderIndexOperationJobResult,
	runFolderIndexOperation,
} from "@/services/folder-index/operations";
import { backgroundProcessFactory } from "./process-factory";
import type {
	BaseJob,
	ItemHandlerResult,
	ProcessDependencies,
	ProcessHandler,
} from "./types";

const isFolderIndexPayload = (
	value: unknown,
): value is FolderIndexOperationJobPayload =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { operation?: unknown }).operation === "string" &&
	typeof (value as { payload?: unknown }).payload === "object";

/**
 * Folder index operations from the UI: the Indexes settings, the index bar
 * and file cards in Files. Runs where the background jobs run, beside the
 * agent tools that read the same indexes.
 */
export class FolderIndexOperationsHandler implements ProcessHandler<BaseJob> {
	async process(
		_jobId: string,
		job: BaseJob,
		_dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		if (!isFolderIndexPayload(job.payload)) {
			throw new Error("Invalid folder-index-operation payload");
		}
		return runFolderIndexOperation(job.payload);
	}
}

backgroundProcessFactory.register({
	instance: new FolderIndexOperationsHandler(),
	jobs: [FOLDER_INDEX_OPERATION_JOB_NAME],
});

declare global {
	interface JobTypeRegistry {
		[FOLDER_INDEX_OPERATION_JOB_NAME]: FolderIndexOperationJobPayload;
	}

	interface JobResultRegistry {
		[FOLDER_INDEX_OPERATION_JOB_NAME]: FolderIndexOperationJobResult;
	}
}
