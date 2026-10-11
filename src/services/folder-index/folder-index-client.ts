import { backgroundJob } from "@/services/background-jobs/background-job";
import {
	FOLDER_INDEX_OPERATION_JOB_NAME,
	type FolderIndexOperation,
	type FolderIndexOperationJobPayload,
	type FolderIndexOperationJobResult,
	type FolderIndexOperationPayloadMap,
	type FolderIndexOperationResultMap,
} from "./operation-types";

/**
 * UI-side access to folder indexes. The indexes are read and written where
 * the background jobs run (offscreen on the extension, in the page on web
 * and desktop), so every caller sees the same store.
 */
export const folderIndexClient = {
	async request<T extends FolderIndexOperation>(
		operation: T,
		payload: FolderIndexOperationPayloadMap[T],
	): Promise<FolderIndexOperationResultMap[T]> {
		const executeResult = await backgroundJob.execute(
			FOLDER_INDEX_OPERATION_JOB_NAME,
			{ operation, payload } as FolderIndexOperationJobPayload,
			{ stream: false },
		);
		if (!("promise" in executeResult)) {
			throw new Error("Expected promise result from non-streaming execute");
		}
		const result = await executeResult.promise;
		if (result.status !== "completed") {
			throw new Error(
				result.error || `Folder index operation failed: ${operation}`,
			);
		}
		const jobResult = result.result as
			| FolderIndexOperationJobResult
			| undefined;
		if (!jobResult || jobResult.operation !== operation) {
			throw new Error(`Folder index operation response mismatch: ${operation}`);
		}
		return jobResult.result as FolderIndexOperationResultMap[T];
	},
};
