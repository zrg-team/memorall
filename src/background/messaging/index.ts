import { logInfo, logError } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { activityTrackingManager } from "@/background/activity-tracking-manager";
import { BACKGROUND_EVENTS } from "@/constants/events";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import {
	DOCUMENTS_SANDBOX_ROOT,
	toDocumentsSandboxPath,
} from "@/services/filesystem/sandbox-paths";
import {
	isJobNotificationMessage,
	type JobNotificationMessage,
} from "@/services/background-jobs/bridges/types";
import { openExtensionPopup } from "@/background/core/notifications";
import {
	isRelayableContentSender,
	registerContentJobConsumer,
	relayJobNotificationToContent,
	unregisterContentJobConsumer,
} from "./relay";
import type { BackgroundMessage } from "@/embedded/types";
import {
	CO_AGENT_ACTIVE_SESSION_STORAGE_KEY,
	CO_AGENT_CONTENT_COMMAND_SOURCE,
} from "@/services/co-agent";

// ── Individual handlers ───────────────────────────────────────────────────────

type SendResponse = (response?: unknown) => void;

function handleActivityCaptured(
	message: Record<string, unknown>,
	senderTabId: number | undefined,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			if (!senderTabId) {
				sendResponse({ success: false, error: "No tab ID" });
				return;
			}
			if (typeof message.activityType !== "string") {
				sendResponse({ success: false, error: "Invalid activity type" });
				return;
			}
			await activityTrackingManager.handleActivityFromContent(
				message.activityType,
				message.data,
				senderTabId,
			);
			sendResponse({ success: true });
		} catch (error) {
			logError("❌ Failed to handle activity from content:", error);
			sendResponse({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	})();
	return true;
}

function handleGetTopicsForSelector(sendResponse: SendResponse): true {
	(async () => {
		try {
			const response = await backgroundJob.execute(
				"get-topics",
				{},
				{ stream: false },
			);

			if ("promise" in response) {
				const result = await response.promise;
				const existingTopics = result?.result?.topics ?? [];
				const topicsWithDefault = [
					{
						id: "default",
						name: "Default",
						description: "Save to default location",
					},
					...existingTopics,
				];
				sendResponse({ success: true, topics: topicsWithDefault });
			}
		} catch (error) {
			logError("❌ Failed to get topics for selector:", error);
			sendResponse({
				success: false,
				error: error instanceof Error ? error.message : "Failed to load topics",
			});
		}
	})();
	return true;
}

function handleOpenFullPage(sendResponse: SendResponse): true {
	(async () => {
		try {
			await chrome.runtime.openOptionsPage?.();
			sendResponse({ success: true });
		} catch (error) {
			logError("❌ Failed to open full page:", error);
			sendResponse({ success: false, error: "Failed to open full page" });
		}
	})();
	return true;
}

function handleOpenSavePage(sendResponse: SendResponse): true {
	try {
		chrome.storage?.session?.set?.({ navigateTo: "documents" });
		void openExtensionPopup();
		sendResponse({ success: true });
	} catch (error) {
		logError("❌ Failed to open documents page:", error);
		sendResponse({ success: false, error: "Failed to open documents page" });
	}
	return true;
}

function handleCoAgentSetActive(
	msg: Record<string, unknown>,
	senderTabId: number | undefined,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			const tabId = typeof msg.tabId === "number" ? msg.tabId : senderTabId;
			if (!tabId) {
				sendResponse({ success: false, error: "No tab ID" });
				return;
			}
			const tab = await chrome.tabs.get(tabId).catch(() => null);
			await chrome.storage?.session?.set?.({
				[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY]: {
					tabId,
					windowId: tab?.windowId,
					url: typeof msg.url === "string" ? msg.url : tab?.url,
					title: tab?.title,
					enabledAt: Date.now(),
				},
			});
			sendResponse({ success: true });
		} catch (error) {
			logError("❌ Failed to set active co-agent tab:", error);
			sendResponse({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to set active co-agent tab",
			});
		}
	})();
	return true;
}

function handleCoAgentHide(
	senderTabId: number | undefined,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			const result = await chrome.storage?.session?.get?.(
				CO_AGENT_ACTIVE_SESSION_STORAGE_KEY,
			);
			const active = result?.[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY] as
				| { tabId?: number }
				| undefined;
			if (!senderTabId || active?.tabId === senderTabId) {
				await chrome.storage?.session?.remove?.(
					CO_AGENT_ACTIVE_SESSION_STORAGE_KEY,
				);
			}
			sendResponse({ success: true });
		} catch (error) {
			logError("❌ Failed to hide co-agent:", error);
			sendResponse({ success: false, error: "Failed to hide co-agent" });
		}
	})();
	return true;
}

function handleCoAgentGetTrace(
	senderTabId: number | undefined,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			let tabId = senderTabId;
			if (!tabId) {
				const result = await chrome.storage?.session?.get?.(
					CO_AGENT_ACTIVE_SESSION_STORAGE_KEY,
				);
				const active = result?.[CO_AGENT_ACTIVE_SESSION_STORAGE_KEY] as
					| { tabId?: number }
					| undefined;
				tabId = active?.tabId;
			}
			if (!tabId) {
				sendResponse({ success: false, error: "No active co-agent tab" });
				return;
			}
			const response = await chrome.tabs.sendMessage(tabId, {
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:get-trace",
			});
			sendResponse({ success: true, trace: response });
		} catch (error) {
			logError("❌ Failed to get co-agent trace:", error);
			sendResponse({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to get co-agent trace",
			});
		}
	})();
	return true;
}

function handleOpenFullChatWithContext(
	msg: BackgroundMessage,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			if (msg.context) {
				chrome.storage?.session?.set?.({ smartSelectContext: msg.context });
			}
			try {
				await chrome.runtime.openOptionsPage?.();
			} catch {
				const optionsUrl = chrome.runtime.getURL("standalone.html");
				const existing = await chrome.tabs.query({ url: optionsUrl });
				if (existing.length > 0) {
					await chrome.tabs.update(existing[0].id!, { active: true });
					await chrome.windows.update(existing[0].windowId!, { focused: true });
				} else {
					await chrome.tabs.create({ url: optionsUrl, active: true });
				}
			}
			sendResponse({ success: true });
		} catch (error) {
			logError("❌ Failed to open full chat with context:", error);
			sendResponse({ success: false, error: "Failed to open full chat" });
		}
	})();
	return true;
}

function collectDocumentFolderPaths(
	nodes: Array<{
		type: "file" | "folder";
		path: string;
		children?: Array<{
			type: "file" | "folder";
			path: string;
			children?: any[];
		}>;
	}>,
): string[] {
	const folders = new Set<string>(["/"]);
	const visit = (items: typeof nodes): void => {
		items.forEach((node) => {
			if (node.type === "folder") {
				folders.add(node.path);
			}
			if (node.children && node.children.length > 0) {
				visit(node.children as typeof nodes);
			}
		});
	};
	visit(nodes);
	return Array.from(folders).sort((left, right) => left.localeCompare(right));
}

function handleGetDocumentFolders(sendResponse: SendResponse): true {
	(async () => {
		try {
			await documentFileSystemService.initialize();
			const tree = await documentFileSystemService.getTree(
				DOCUMENTS_SANDBOX_ROOT,
			);
			sendResponse({
				success: true,
				folders: collectDocumentFolderPaths(tree),
			});
		} catch (error) {
			logError("❌ Failed to load document folders:", error);
			sendResponse({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to load document folders",
			});
		}
	})();
	return true;
}

function handleSaveEmbeddedContextPreview(
	message: Record<string, unknown>,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			const logicalFolder =
				typeof message.folderPath === "string" && message.folderPath.trim()
					? message.folderPath
					: "/";
			const folderPath = toDocumentsSandboxPath(logicalFolder);
			const fileName =
				typeof message.fileName === "string" && message.fileName.trim()
					? message.fileName.trim()
					: null;

			if (!fileName) {
				sendResponse({ success: false, error: "Missing file name" });
				return;
			}

			await documentFileSystemService.initialize();

			if (
				Array.isArray(message.imageSources) &&
				message.imageSources.length > 0
			) {
				const lastDotIndex = fileName.lastIndexOf(".");
				const baseName =
					lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex);
				const extension =
					lastDotIndex === -1 ? ".png" : fileName.slice(lastDotIndex);

				for (let index = 0; index < message.imageSources.length; index += 1) {
					const source = message.imageSources[index];
					if (typeof source !== "string" || !source) {
						continue;
					}

					const response = await fetch(source);
					const blob = await response.blob();
					const numberedName =
						message.imageSources.length > 1
							? `${baseName}-${index + 1}${extension}`
							: `${baseName}${extension}`;
					const file = new File([blob], numberedName, {
						type: blob.type || "image/png",
					});
					await documentFileSystemService.uploadFile(file, folderPath);
				}

				sendResponse({ success: true });
				return;
			}

			const content =
				typeof message.content === "string" ? message.content : "";
			const mimeType =
				typeof message.mimeType === "string" && message.mimeType
					? message.mimeType
					: "text/plain";
			const file = new File([content], fileName, { type: mimeType });
			await documentFileSystemService.uploadFile(file, folderPath);
			sendResponse({ success: true });
		} catch (error) {
			logError("❌ Failed to save embedded context preview:", error);
			sendResponse({
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to save embedded context preview",
			});
		}
	})();
	return true;
}

function handleSaveContentWithTopic(
	message: Record<string, unknown>,
	senderTabId: number | undefined,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			logInfo("🔍 Background received topicId:", message.topicId);

			if (!senderTabId) {
				sendResponse({ success: false, error: "No active tab" });
				return;
			}

			const extractionResponse = await chrome.tabs.sendMessage(senderTabId, {
				type: BACKGROUND_EVENTS.REMEMBER_THIS,
				tabId: senderTabId,
				topicId: message.topicId,
			});

			sendResponse(
				extractionResponse?.success
					? { success: true }
					: { success: false, error: "Failed to extract page content" },
			);
		} catch (error) {
			logError("❌ Failed to save content with topic:", error);
			sendResponse({
				success: false,
				error: "Failed to save content with topic",
			});
		}
	})();
	return true;
}

function handleContentExtracted(
	message: Record<string, unknown>,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			const saveResponse = await backgroundJob.execute(
				"remember-save",
				message.data,
				{ stream: false },
			);

			if (!("promise" in saveResponse)) {
				throw new Error("Failed to process extracted content");
			}

			const saveResult = (await saveResponse.promise).result;

			if (!saveResult || !("filePath" in saveResult)) {
				throw new Error("No file path returned from save operation");
			}

			logInfo("✅ Content saved as file:", saveResult.filePath);
			sendResponse({ success: true, filePath: saveResult.filePath });
		} catch (error) {
			logError("❌ Failed to process extracted content:", error);
			const errorMsg =
				error instanceof Error ? error.message : "Failed to save content";
			logInfo("📨 Sending error response to content script:", errorMsg);
			sendResponse({ success: false, error: errorMsg });
		}
	})();
	return true;
}

function handleResetLLMService(
	message: Record<string, unknown>,
	sendResponse: SendResponse,
): true {
	(async () => {
		try {
			const response = await chrome.runtime.sendMessage({
				type: "OFFSCREEN_RESET_LLM_SERVICE",
				service: message.service,
			});
			sendResponse(
				response ?? { success: false, error: "No response from offscreen" },
			);
		} catch (error) {
			sendResponse({
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to reset service",
			});
		}
	})();
	return true;
}

function handleGetServiceStatus(sendResponse: SendResponse): true {
	(async () => {
		try {
			const response = await chrome.runtime.sendMessage({
				type: "OFFSCREEN_GET_SERVICE_STATUS",
			});
			sendResponse(response ?? { success: false, statuses: {} });
		} catch (error) {
			sendResponse({ success: false, statuses: {} });
		}
	})();
	return true;
}

function handleFilesystemChanged(message: Record<string, unknown>): false {
	if (message.relayedByBackground === true) return false;

	const sourceContextId =
		typeof message.sourceContextId === "string"
			? message.sourceContextId
			: undefined;
	const eventId =
		typeof message.eventId === "string" ? message.eventId : undefined;
	const change = "change" in message ? message.change : undefined;

	logInfo("🔁 Relaying FILESYSTEM_CHANGED to all contexts");

	chrome.runtime
		.sendMessage({
			type: BACKGROUND_EVENTS.FILESYSTEM_CHANGED,
			sourceContextId,
			eventId,
			change,
			relayedByBackground: true,
		})
		.catch((err: Error) => {
			if (
				!err.message?.includes("Receiving end does not exist") &&
				!err.message?.includes("Could not establish connection")
			) {
				logError("Failed to relay FILESYSTEM_CHANGED:", err);
			}
		});

	return false;
}

// ── Listener registration ─────────────────────────────────────────────────────

export function registerMessageHandler(onPopupOpened: () => void): void {
	// A tab that stops existing cannot consume anything.
	chrome.tabs.onRemoved.addListener((tabId) => {
		unregisterContentJobConsumer(tabId);
	});

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		// Job notification relay — must come first
		if (isJobNotificationMessage(message)) {
			// A content script that enqueues a job is a tab that wants the progress
			// and the result back. Registering here also survives a service-worker
			// restart, since the job that matters always starts with a message from
			// the tab. Extension pages are excluded — runtime.sendMessage already
			// reached them, and relaying again would double every chunk.
			if (isRelayableContentSender(message as JobNotificationMessage, sender)) {
				registerContentJobConsumer(sender.tab?.id);
			}
			if (message.target === "content" || message.target === "all") {
				void relayJobNotificationToContent(
					message as JobNotificationMessage,
					sender.tab?.id,
				);
			}
			return false;
		}

		const msg = message as Record<string, unknown>;
		const type = msg.type;

		if (type === BACKGROUND_EVENTS.POPUP_OPENED) {
			logInfo("🪟 Popup opened");
			onPopupOpened();
			return false;
		}

		if (type === BACKGROUND_EVENTS.ACTIVITY_CAPTURED)
			return handleActivityCaptured(msg, sender.tab?.id, sendResponse);

		if (type === BACKGROUND_EVENTS.GET_TOPICS_FOR_SELECTOR)
			return handleGetTopicsForSelector(sendResponse);

		if (type === BACKGROUND_EVENTS.GET_DOCUMENT_FOLDERS)
			return handleGetDocumentFolders(sendResponse);

		if (type === BACKGROUND_EVENTS.OPEN_FULL_PAGE)
			return handleOpenFullPage(sendResponse);

		if (type === BACKGROUND_EVENTS.OPEN_SAVE_PAGE)
			return handleOpenSavePage(sendResponse);

		if (type === BACKGROUND_EVENTS.CO_AGENT_SET_ACTIVE)
			return handleCoAgentSetActive(msg, sender.tab?.id, sendResponse);

		if (type === BACKGROUND_EVENTS.HIDE_CO_AGENT)
			return handleCoAgentHide(sender.tab?.id, sendResponse);

		if (type === BACKGROUND_EVENTS.CO_AGENT_GET_TRACE)
			return handleCoAgentGetTrace(sender.tab?.id, sendResponse);

		if (type === BACKGROUND_EVENTS.OPEN_FULL_CHAT_WITH_CONTEXT)
			return handleOpenFullChatWithContext(
				msg as unknown as BackgroundMessage,
				sendResponse,
			);

		if (type === BACKGROUND_EVENTS.SAVE_CONTENT_WITH_TOPIC)
			return handleSaveContentWithTopic(msg, sender.tab?.id, sendResponse);

		if (type === BACKGROUND_EVENTS.SAVE_EMBEDDED_CONTEXT_PREVIEW)
			return handleSaveEmbeddedContextPreview(msg, sendResponse);

		if (type === BACKGROUND_EVENTS.CONTENT_EXTRACTED)
			return handleContentExtracted(msg, sendResponse);

		if (type === BACKGROUND_EVENTS.FILESYSTEM_CHANGED)
			return handleFilesystemChanged(msg);

		if (type === BACKGROUND_EVENTS.RESET_LLM_SERVICE)
			return handleResetLLMService(msg, sendResponse);

		if (type === BACKGROUND_EVENTS.GET_SERVICE_STATUS)
			return handleGetServiceStatus(sendResponse);
	});
}
