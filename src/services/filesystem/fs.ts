import { configure, InMemory, fs } from "@zenfs/core";
import { IndexedDB } from "@zenfs/dom";
import { logDebug, logError, logInfo } from "@/utils/logger";
import { syncNativeFolderMounts } from "./native-folders/mount-registry";

let fsReady = false;
let fsReadyPromise: Promise<void> | null = null;
let refreshInProgress = false;

// Initialize filesystem configuration
const initializeFs = async (): Promise<void> => {
	if (fsReady) return;

	if (!fsReadyPromise) {
		fsReadyPromise = configure({
			mounts: {
				"/tmp": InMemory,
				"/home": IndexedDB,
			},
		})
			.then(async () => {
				fsReady = true;
				logDebug("Filesystem configured");
				// A no-op unless the platform has folders mapped, so extension and
				// web behaviour is unchanged.
				await syncNativeFolderMounts();
			})
			.catch((error) => {
				logError("Filesystem configuration error", error);
				fsReadyPromise = null; // Reset so retry is possible
				throw error;
			});
	}

	return fsReadyPromise;
};

/**
 * Force ZenFS to refresh its cache by reconfiguring it
 * This is necessary when files are modified in a different context (e.g., offscreen)
 * and we need to ensure the current context sees the latest data from IndexedDB
 */
const refreshFsCache = async (): Promise<void> => {
	// Prevent concurrent refresh attempts
	if (refreshInProgress) {
		logInfo("⏸️ Refresh already in progress, skipping...");
		return;
	}

	refreshInProgress = true;

	const refreshPromise = (async () => {
		try {
			logInfo(
				"🔄 Refreshing ZenFS cache (unmounting and reconfiguring filesystem)",
			);

			// Reset ready state before remounting.
			fsReady = false;

			// Unmount existing mounts to avoid "already in use" errors
			try {
				await fs.umount("/tmp");
				logInfo("📤 Unmounted /tmp");
			} catch (e) {
				// Ignore if not mounted
				logDebug("Could not unmount /tmp:", e);
			}

			try {
				await fs.umount("/home");
				logInfo("📤 Unmounted /home");
			} catch (e) {
				// Ignore if not mounted
				logDebug("Could not unmount /home:", e);
			}

			// Small delay to ensure unmounting is complete
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Reconfigure the filesystem - this forces ZenFS to reload from IndexedDB
			await configure({
				mounts: {
					"/tmp": InMemory,
					"/home": IndexedDB,
				},
			});

			fsReady = true;
			// configure() rebuilt the tree from the two static mounts, which
			// silently drops every mapped folder. Put them back before anything
			// reads the filesystem again.
			await syncNativeFolderMounts();
			logInfo("✅ ZenFS cache refreshed successfully");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// If another configure won the race and mounts already exist, treat as success.
			if (message.includes("Mount point is already in use")) {
				logInfo(
					"ℹ️ ZenFS mounts already configured, skipping duplicate refresh",
				);
				fsReady = true;
				await syncNativeFolderMounts();
				return;
			}

			logError("Failed to refresh ZenFS cache:", error);
			// Reset state so next call can try again
			fsReady = false;
			throw error;
		}
	})();

	// Share one promise across initialize/refresh so configure cannot run in parallel.
	fsReadyPromise = refreshPromise;

	try {
		await refreshPromise;
	} finally {
		refreshInProgress = false;
	}
};

// Start initialization immediately
initializeFs();

// Export both the fs object and the ready promise
export default fs;
export { initializeFs, fsReady, refreshFsCache };
