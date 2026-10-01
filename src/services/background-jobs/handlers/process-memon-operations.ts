import {
	MEMON_OPERATION_JOB_NAME,
	type MemonOperationJobPayload,
	type MemonOperationJobResult,
	runMemonOperation,
} from "@/services/memon/operations";
import { backgroundProcessFactory } from "./process-factory";
import type {
	BaseJob,
	ItemHandlerResult,
	ProcessDependencies,
	ProcessHandler,
} from "./types";

const isMemonOperationPayload = (
	value: unknown,
): value is MemonOperationJobPayload =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { operation?: unknown }).operation === "string" &&
	typeof (value as { payload?: unknown }).payload === "object";

/**
 * MemonOS Bot computer operations from the UI: user input, take over / resume,
 * and snapshot pulls. Runs where the machines live (offscreen on the
 * extension, in the page on web and desktop).
 */
export class MemonOperationsHandler implements ProcessHandler<BaseJob> {
	async process(
		_jobId: string,
		job: BaseJob,
		_dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		if (!isMemonOperationPayload(job.payload)) {
			throw new Error("Invalid memon-operation payload");
		}
		const result = await runMemonOperation(job.payload);
		return { operation: job.payload.operation, result };
	}
}

backgroundProcessFactory.register({
	instance: new MemonOperationsHandler(),
	jobs: [MEMON_OPERATION_JOB_NAME],
});

declare global {
	interface JobTypeRegistry {
		[MEMON_OPERATION_JOB_NAME]: MemonOperationJobPayload;
	}

	interface JobResultRegistry {
		[MEMON_OPERATION_JOB_NAME]: MemonOperationJobResult;
	}
}
