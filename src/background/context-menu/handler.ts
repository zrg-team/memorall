import { logInfo, logError } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { activityTrackingManager } from "@/background/activity-tracking-manager";
import { BACKGROUND_EVENTS } from "@/constants/events";
import {
	createNotification,
	openExtensionPopup,
} from "@/background/core/notifications";
import { MENU_IDS } from "./ids";
import { CO_AGENT_ACTIVE_SESSION_STORAGE_KEY } from "@/services/co-agent";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRestrictedUrl(url: string | undefined): boolean {
	return (
		!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")
	);
}

// ── Individual handlers ───────────────────────────────────────────────────────

async function handleOpenDocuments(): Promise<void> {
	logInfo("📄 Open documents menu item clicked");

	try {
		chrome.storage?.session?.set?.({ navigateTo: "documents" });
		await openExtensionPopup();
	} catch (error) {
		logError("❌ Failed to open documents page:", error);
	}
}

async function handleRecall(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab,
): Promise<void> {
	if (!tab.id) return;

	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		const response = await chrome.tabs.sendMessage(tab.id, {
			type: BACKGROUND_EVENTS.SHOW_CHAT_MODAL,
			tabId: tab.id,
			url: tab.url,
			selectedText: info.selectionText ?? "",
			mode: "general",
			displayMode: "popup",
		});
		logInfo("📨 Content script response to SHOW_CHAT_MODAL:", response);
	} catch (error) {
		logError("❌ Failed to show chat modal:", error);
	}
}

async function handleCoAgent(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab,
): Promise<void> {
	if (!tab.id) return;

	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		await chrome.storage?.session?.set?.({
			[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY]: {
				tabId: tab.id,
				windowId: tab.windowId,
				url: tab.url,
				title: tab.title,
				enabledAt: Date.now(),
			},
		});

		const response = await chrome.tabs.sendMessage(tab.id, {
			type: BACKGROUND_EVENTS.SHOW_CO_AGENT,
			tabId: tab.id,
			url: tab.url,
			selectedText: info.selectionText ?? "",
			mode: "general",
			displayMode: "popup",
			coAgentEnabled: true,
		});
		logInfo("📨 Content script response to SHOW_CO_AGENT:", response);
	} catch (error) {
		logError("❌ Failed to show co-agent:", error);
	}
}

async function handleCanvasSelect(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab,
): Promise<void> {
	if (!tab.id) return;

	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		const response = await chrome.tabs.sendMessage(tab.id, {
			type: BACKGROUND_EVENTS.ACTIVATE_CANVAS_SELECTOR,
			tabId: tab.id,
			url: tab.url,
		});
		logInfo(
			"📨 Content script response to ACTIVATE_CANVAS_SELECTOR:",
			response,
		);
	} catch (error) {
		logError("❌ Failed to show canvas select:", error);
	}
}

async function handleStartCapture(): Promise<void> {
	try {
		logInfo("🎯 Start capturing activities clicked");
		await activityTrackingManager.startTracking();

		await chrome.contextMenus.update(MENU_IDS.START_CAPTURE, {
			visible: false,
		});
		await chrome.contextMenus.update(MENU_IDS.STOP_CAPTURE, { visible: true });

		createNotification(
			"AI Session Started",
			"AI is now helping you remember your browsing. Click 'End AI session' when done.",
		);
	} catch (error) {
		logError("❌ Failed to start activity tracking:", error);
		createNotification(
			"AI Session",
			"Failed to start AI session. Please try again.",
		);
	}
}

async function handleStopCapture(): Promise<void> {
	try {
		logInfo("⏹️ Stop capturing activities clicked");
		await activityTrackingManager.stopTracking();

		await chrome.contextMenus.update(MENU_IDS.START_CAPTURE, { visible: true });
		await chrome.contextMenus.update(MENU_IDS.STOP_CAPTURE, { visible: false });

		createNotification(
			"AI Session Ended",
			"Session saved to your memory timeline. Click 'View my memory timeline' to review.",
		);
	} catch (error) {
		logError("❌ Failed to stop activity tracking:", error);
		createNotification("AI Session", "Failed to end AI session.");
	}
}

async function handleViewActivities(): Promise<void> {
	try {
		logInfo("📊 View captured activities clicked");
		chrome.storage?.session?.set?.({ navigateTo: "activities" });
		await chrome.runtime.openOptionsPage?.();
	} catch (error) {
		logError("❌ Failed to open activities view:", error);
		createNotification("Memory Timeline", "Failed to open memory timeline.");
	}
}

async function handleSavePage(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab,
): Promise<void> {
	if (!tab.id) return;

	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		logInfo("💾 Save page clicked - showing topic selector");
		const response = await chrome.tabs.sendMessage(tab.id, {
			type: BACKGROUND_EVENTS.SHOW_TOPIC_SELECTOR,
			tabId: tab.id,
			url: tab.url,
			context: info.selectionText ?? "",
		});
		logInfo("📨 Content script response to SHOW_TOPIC_SELECTOR:", response);
	} catch (error) {
		logError("❌ Failed to show topic selector:", error);
	}
}

async function handleConvertToKnowledge(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab,
): Promise<void> {
	if (!tab.id) return;

	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		if (!info.selectionText?.trim()) {
			createNotification(
				"Convert to Knowledge",
				"Please select some text to convert.",
			);
			return;
		}

		logInfo("🧠 Convert to knowledge clicked", {
			selectionLength: info.selectionText.length,
			pageUrl: tab.url,
		});

		createNotification(
			"Converting to Knowledge",
			"Processing your selected text...",
		);

		const selectionId = `selection-${Date.now()}-${Math.random().toString(36).substring(7)}`;
		const sourceInfo = `Selection from: ${tab.title ?? "Unknown"}\nOriginal URL: ${tab.url}\n\n`;
		const fullContent = sourceInfo + info.selectionText;

		const result = await backgroundJob.execute(
			"knowledge-graph",
			{
				filePath: selectionId,
				content: fullContent,
				isSpecificTextConversion: true,
			},
			{ stream: false },
		);

		if ("promise" in result) await result.promise;

		logInfo("✅ Selection converted to knowledge successfully", {
			selectionId,
		});
		createNotification(
			"Knowledge Conversion Complete",
			"Your selected text has been converted to knowledge.",
		);
	} catch (error) {
		logError("❌ Failed to convert selection to knowledge:", error);
		createNotification(
			"Conversion Failed",
			"Failed to convert text to knowledge. Please try again.",
		);
	}
}

async function handleSmartSelector(tab: chrome.tabs.Tab): Promise<void> {
	if (!tab.id) return;

	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		const response = await chrome.tabs.sendMessage(tab.id, {
			type: BACKGROUND_EVENTS.ACTIVATE_SMART_SELECTOR,
			tabId: tab.id,
			url: tab.url,
		});
		logInfo("📨 Content script response to ACTIVATE_SMART_SELECTOR:", response);
	} catch (error) {
		logError("❌ Failed to activate smart selector:", error);
	}
}

async function handleOpenPlatform(tab: chrome.tabs.Tab): Promise<void> {
	try {
		if (isRestrictedUrl(tab.url)) {
			logError("❌ Cannot access this page type");
			return;
		}

		logInfo("🚀 Open platform clicked");

		try {
			await chrome.runtime.openOptionsPage?.();
			logInfo("🪟 Platform opened via openOptionsPage()");
		} catch (err) {
			logError("⚠️ openOptionsPage failed, falling back to tab create:", err);
			const optionsUrl = chrome.runtime.getURL("standalone.html");
			const existing = await chrome.tabs.query({ url: optionsUrl });

			if (existing.length > 0) {
				await chrome.tabs.update(existing[0].id!, { active: true });
				await chrome.windows.update(existing[0].windowId!, { focused: true });
			} else {
				await chrome.tabs.create({ url: optionsUrl, active: true });
			}
		}
	} catch (error) {
		logError("❌ Failed to process save request:", error);
		try {
			createNotification(
				"Memorall",
				"Failed to save content. Please try again.",
			);
		} catch {}
	}
}

// ── Listener registration ─────────────────────────────────────────────────────

export function registerContextMenuHandler(): void {
	chrome.contextMenus.onClicked.addListener(async (info, tab) => {
		logInfo("📋 Context menu clicked:", {
			menuItemId: info.menuItemId,
			tabUrl: tab?.url,
			tabId: tab?.id,
			pageUrl: info.pageUrl,
			linkUrl: info.linkUrl,
		});

		if (!tab) return;

		const id = info.menuItemId as string;

		if (id === MENU_IDS.OPEN_DOCUMENTS) return handleOpenDocuments();
		if (id === MENU_IDS.RECALL) return handleRecall(info, tab);
		if (id === MENU_IDS.CO_AGENT) return handleCoAgent(info, tab);
		if (id === MENU_IDS.CANVAS_SELECT) return handleCanvasSelect(info, tab);
		if (id === MENU_IDS.START_CAPTURE) return handleStartCapture();
		if (id === MENU_IDS.STOP_CAPTURE) return handleStopCapture();
		if (id === MENU_IDS.VIEW_ACTIVITIES) return handleViewActivities();
		if (id === MENU_IDS.SAVE_PAGE) return handleSavePage(info, tab);
		if (id === MENU_IDS.CONVERT_TO_KNOWLEDGE)
			return handleConvertToKnowledge(info, tab);
		if (id === MENU_IDS.SMART_SELECTOR) return handleSmartSelector(tab);
		if (id === MENU_IDS.OPEN_PLATFORM) return handleOpenPlatform(tab);
	});
}
