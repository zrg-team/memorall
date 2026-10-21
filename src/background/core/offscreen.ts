import { logInfo, logError } from "@/utils/logger";
import { sharedStorageService } from "@/services/shared-storage";

let offscreenCreated = false;
let offscreenInitPromise: Promise<void> | null = null;

const OFFSCREEN_URL = () => chrome.runtime.getURL("offscreen.html");

async function resetOffscreenProgress(): Promise<void> {
	await sharedStorageService.set("offscreenProgress", {
		done: false,
		progress: 0,
		status: "Pending",
	});
}

export async function closeOffscreenDocument(): Promise<void> {
	try {
		if (!chrome.offscreen) {
			logInfo("⚠️ Chrome offscreen API not available");
			return;
		}

		const contexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});

		if (contexts.length > 0) {
			logInfo(`🗑️ Closing ${contexts.length} existing offscreen document(s)...`);
			await chrome.offscreen.closeDocument();
			logInfo("✅ Offscreen document(s) closed");
		} else {
			logInfo("ℹ️ No existing offscreen documents to close");
		}

		logInfo(
			"🧹 Clearing offscreen initialization status from shared storage...",
		);
		await resetOffscreenProgress();
	} catch (error) {
		logError("⚠️ Error closing offscreen document:", error);
		try {
			await resetOffscreenProgress();
		} catch {}
	} finally {
		offscreenCreated = false;
		offscreenInitPromise = null;
	}
}

export async function ensureOffscreenDocument(): Promise<void> {
	if (offscreenCreated) return;
	if (offscreenInitPromise) return offscreenInitPromise;

	offscreenInitPromise = (async () => {
		logInfo("🔄 Attempting to create offscreen document...");

		if (!chrome.offscreen) {
			throw new Error("Chrome offscreen API not available");
		}

		const offscreenUrl = OFFSCREEN_URL();
		const contexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});

		const mainOffscreenDoc = contexts.find(
			(ctx) => ctx.documentUrl === offscreenUrl && ctx.frameId === 0,
		);

		if (mainOffscreenDoc) {
			offscreenCreated = true;
			logInfo("✅ Offscreen document already exists", mainOffscreenDoc);
			return;
		}

		if (contexts.length > 0) {
			logInfo(
				"⚠️ Found offscreen contexts but no main offscreen.html - they are likely iframes",
				contexts,
			);
		}

		logInfo("🔄 Creating offscreen document", { url: offscreenUrl });
		// Progress belongs to the document that owns the database. Only reset it
		// when creating a new owner; a reused document keeps its current status.
		await resetOffscreenProgress();

		try {
			await chrome.offscreen.createDocument({
				url: offscreenUrl,
				reasons: [
					chrome.offscreen.Reason.IFRAME_SCRIPTING,
					chrome.offscreen.Reason.USER_MEDIA,
				],
				justification:
					"Run local AI services and record user-selected tab audio for continuous transcription",
			});
			offscreenCreated = true;
			logInfo("✅ Offscreen document created successfully");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes("Only a single offscreen document")) {
				logInfo("ℹ️ Offscreen already exists (create rejected). Proceeding.");
				offscreenCreated = true;
			} else {
				throw err;
			}
		}
	})();

	try {
		await offscreenInitPromise;
	} finally {
		// A failed create must not permanently cache a rejected promise.
		offscreenInitPromise = null;
	}
}

export async function offscreenWatchdogCheck(): Promise<void> {
	try {
		if (!chrome.offscreen) return;

		const offscreenUrl = OFFSCREEN_URL();
		const contexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});

		const hasMainOffscreen = contexts.some(
			(ctx) => ctx.documentUrl === offscreenUrl && ctx.frameId === 0,
		);

		if (!hasMainOffscreen) {
			logInfo("🩺 Offscreen watchdog: offscreen missing → reinitializing");
			offscreenCreated = false;
			offscreenInitPromise = null;
			await ensureOffscreenDocument();
			logInfo("✅ Offscreen watchdog: offscreen restored");
		}
	} catch (error) {
		logError("⚠️ Offscreen watchdog check failed:", error);
	}
}
