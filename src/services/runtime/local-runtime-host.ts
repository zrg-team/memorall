import { backgroundJob } from "@/services/background-jobs/background-job";
import {
	backgroundProcessFactory,
	ProcessFactory,
} from "@/services/background-jobs/handlers";
import { logDebug, logError, logInfo } from "@/utils/logger";
import { RuntimeProcessor } from "./runtime-processor";

let processor: RuntimeProcessor | null = null;
let starting: Promise<RuntimeProcessor> | null = null;

export async function ensureLocalRuntimeProcessor(): Promise<RuntimeProcessor> {
	if (processor?.getState() === "running") return processor;
	if (starting) return starting;

	starting = (async () => {
		const dependencies = ProcessFactory.createDependencies(
			(jobId, progress) => backgroundJob.updateJobProgress(jobId, progress),
			(jobId, result) => backgroundJob.completeJob(jobId, result),
		);
		backgroundProcessFactory.setDependencies(dependencies);

		const runtime = new RuntimeProcessor({
			notifications: backgroundJob.getNotificationBridge(),
			listPendingJobs: () => backgroundJob.getAllJobs(),
			executeJob: (job) => backgroundProcessFactory.executeJob(job.id, job),
			logger: {
				debug: (message, data) => logDebug(message, data),
				info: (message, data) => logInfo(message, data),
				error: (message, error) => logError(message, error),
			},
		});
		await runtime.start();
		processor = runtime;
		return runtime;
	})().finally(() => {
		starting = null;
	});

	return starting;
}
