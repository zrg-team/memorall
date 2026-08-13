import { platform } from "@/platform/current";
import { serviceManager } from "@/services";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { sharedStorageService } from "@/services/shared-storage/shared-storage-service";
import { ensureLocalRuntimeProcessor } from "@/services/runtime/local-runtime-host";

export interface RuntimeInitializationProgress {
	stage: string;
	progress: number;
	status: "initializing" | "completed" | "error";
}

export async function initializeRuntimeServices(
	onProgress: (progress: RuntimeInitializationProgress) => void,
): Promise<void> {
	await sharedStorageService.initialize();

	if (platform.environment === "extension") {
		const progressStream = await backgroundJob.initializeServices();
		let ready = false;
		for await (const progress of progressStream) {
			onProgress({
				stage: progress.stage,
				progress: progress.progress,
				status:
					progress.status === "error"
						? "error"
						: progress.status === "completed"
							? "completed"
							: "initializing",
			});
			if (progress.status === "error") throw new Error(progress.stage);
			if (progress.status === "completed") {
				ready = true;
				break;
			}
		}
		if (!ready) {
			throw new Error(
				"Offscreen initialization ended before services were ready",
			);
		}
		await serviceManager.initialize({ proxy: true });
		return;
	}

	// Compatibility host for the first web/desktop rollout. RuntimeProcessor will
	// move this exact full-service initialization into the selected worker host;
	// keeping it here makes the shared UI usable while transports are migrated.
	const unsubscribe = serviceManager.onProgressChange((progress) => {
		onProgress({
			stage: progress.step,
			progress: progress.progress,
			status: progress.isComplete ? "completed" : "initializing",
		});
	});
	try {
		await serviceManager.initialize({
			proxy: false,
			exposeDatabaseRpc: false,
		});
		await ensureLocalRuntimeProcessor();
	} finally {
		unsubscribe();
	}
}
