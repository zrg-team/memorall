import { logInfo, logError } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { sharedStorageService } from "@/services/shared-storage";
import { ensureOffscreenDocument } from "./offscreen";
import { loadCurrentLanguage } from "./language";

let initializationInProgress = false;
let initialized = false;

export function isInitializing(): boolean {
	return initializationInProgress;
}

export async function init(): Promise<void> {
	if (initializationInProgress) {
		logInfo("⏸️ Initialization already in progress, skipping...");
		return;
	}

	if (initialized) {
		logInfo("✅ Already initialized, skipping...");
		return;
	}

	initializationInProgress = true;

	try {
		logInfo("[BACKGROUND] Init - running in service worker context");

		await sharedStorageService.initialize();
		logInfo("✅[BACKGROUND] Shared storage service initialized");

		await backgroundJob.initialize();
		logInfo("✅ Background job queue initialized");

		logInfo("✅[BACKGROUND] Job notification relay ready (inline)");

		// A watchdog or page can have started the database already. Closing its
		// document here tears down PGlite without waiting for pending writes.
		// Reuse that owner; ensureOffscreenDocument creates one only if missing.
		logInfo("🔄[BACKGROUND] Ensuring offscreen document exists...");
		await ensureOffscreenDocument();
		logInfo("✅[BACKGROUND] Offscreen document created");

		logInfo("🔄[BACKGROUND] Waiting for offscreen services to initialize...");
		const progressStream = await backgroundJob.initializeServices();

		for await (const progress of progressStream) {
			logInfo(
				`🚀[BACKGROUND] Offscreen services progress: ${progress.progress}% - ${progress.status}`,
			);
			if (progress.status === "completed") {
				logInfo("✅[BACKGROUND] Offscreen services fully initialized");
				break;
			}
		}

		await loadCurrentLanguage();

		initialized = true;
		logInfo("✅[BACKGROUND] Initialization completed successfully");
	} catch (error) {
		logError("❌[BACKGROUND] Failed initialization:", error);
		// Do not set initialized = true — allow retry on next lifecycle event.
	} finally {
		initializationInProgress = false;
	}
}
