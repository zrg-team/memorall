// Background service worker entry point.
// Responsibilities: register listeners synchronously, wire subsystems, manage lifecycle.

import { logInfo, logError } from "@/utils/logger";
import { portBridge } from "@/background/port-bridge";
import { init, isInitializing } from "@/background/core/init";
import { offscreenWatchdogCheck } from "@/background/core/offscreen";
import {
	getCurrentLanguage,
	loadCurrentLanguage,
	listenForLanguageChanges,
} from "@/background/core/language";
import {
	createContextMenus,
	updateContextMenuText,
} from "@/background/context-menu";
import { registerContextMenuHandler } from "@/background/context-menu/handler";
import { registerMessageHandler } from "@/background/messaging";
import { registerWebToolBrowserHandler } from "@/background/web-tool-browser-handler";
import { registerCoAgentBrowserHandler } from "@/background/co-agent-browser-handler";

// ── CRITICAL: synchronous setup at module load time ───────────────────────────
// Chrome extensions require onConnect listeners to be registered before any
// connection attempts — they must live in global scope, not inside async calls.

portBridge.initialize({
	proxyOptions: { channelName: "postgres-rpc" },
});

registerContextMenuHandler();
registerWebToolBrowserHandler();
registerCoAgentBrowserHandler();

registerMessageHandler(() => {
	// Safe place to verify offscreen is alive (triggered on popup open)
	if (!isInitializing()) {
		void offscreenWatchdogCheck();
	}
});

listenForLanguageChanges((language) => {
	void updateContextMenuText(language);
});

async function ensureContextMenusReady(): Promise<void> {
	await loadCurrentLanguage();
	await createContextMenus(getCurrentLanguage());
}

// ── Lifecycle events ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
	try {
		logInfo(`🎉 Extension installed/updated: ${details.reason}`);
		await ensureContextMenusReady();
		await init();
	} catch (error) {
		logError("❌ Failed to initialize extension:", error);
	}
});

chrome.runtime.onStartup.addListener(async () => {
	try {
		logInfo("🚀 Browser startup detected - initializing extension");
		await ensureContextMenusReady();
		await init();
		logInfo("✅ Extension ready for browser session");
	} catch (error) {
		logError("❌ Startup error:", error);
	}
});

// ── Offscreen watchdog ────────────────────────────────────────────────────────
// Periodically verify the offscreen document is alive and recreate if missing.

const OFFSCREEN_WATCHDOG_INTERVAL_MS = 60_000; // 1 minute

setInterval(() => {
	if (!isInitializing()) {
		void offscreenWatchdogCheck();
	}
}, OFFSCREEN_WATCHDOG_INTERVAL_MS);

logInfo("🩺 Offscreen watchdog started");
