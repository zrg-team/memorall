import { backgroundJob } from "@/services/background-jobs/background-job";
import {
	MEMON_OPERATION_JOB_NAME,
	type MemonOperation,
	type MemonOperationJobPayload,
	type MemonOperationJobResult,
	type MemonOperationPayloadMap,
	type MemonOperationResultMap,
} from "./operation-types";

/**
 * The extension recreates its offscreen document at install, update and
 * browser start, and the UI can come up (from the last session's ready flag)
 * before the new one has finished starting its services, which can take tens
 * of seconds. Until then it accepts no jobs, so a click on the computer waits
 * for it instead of failing.
 */
const RESTART_RETRY_DELAYS_MS = [
	500, 1_000, 2_000, 3_000, 4_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000,
];
const isRuntimeRestarting = (error: unknown): boolean =>
	error instanceof Error && /did not accept job/.test(error.message);

const runOnce = async <T extends MemonOperation>(
	operation: T,
	payload: MemonOperationPayloadMap[T],
): Promise<MemonOperationResultMap[T]> => {
	const executeResult = await backgroundJob.execute(
		MEMON_OPERATION_JOB_NAME,
		{ operation, payload } as MemonOperationJobPayload,
		{ stream: false },
	);
	if (!("promise" in executeResult)) {
		throw new Error("Expected promise result from non-streaming execute");
	}
	const result = await executeResult.promise;
	if (result.status !== "completed") {
		throw new Error(result.error || `Memon operation failed: ${operation}`);
	}
	const jobResult = result.result as MemonOperationJobResult | undefined;
	if (!jobResult || jobResult.operation !== operation) {
		throw new Error(`Memon operation response mismatch: ${operation}`);
	}
	return jobResult.result as MemonOperationResultMap[T];
};

/**
 * UI-side access to MemonOS machines. One code path on every platform: the
 * job runs offscreen on the extension and in a local processor on web/desktop.
 */
export const memonClient = {
	async request<T extends MemonOperation>(
		operation: T,
		payload: MemonOperationPayloadMap[T],
	): Promise<MemonOperationResultMap[T]> {
		for (const delay of RESTART_RETRY_DELAYS_MS) {
			try {
				return await runOnce(operation, payload);
			} catch (error) {
				if (!isRuntimeRestarting(error)) throw error;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
		return runOnce(operation, payload);
	},
};
