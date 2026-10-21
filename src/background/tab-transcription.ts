import { ensureOffscreenDocument } from "./core/offscreen";
import { reinjectContentScript } from "./content-script-injection";
import {
	TAB_TRANSCRIPTION,
	TAB_TRANSCRIPTION_OFFSCREEN,
	TAB_TRANSCRIPTION_SHOW,
	type TabTranscriptionResponse,
} from "@/services/tab-transcription/types";
import { createNotification } from "./core/notifications";
import { extensionAppUrl } from "@/platform/extension/extension-app-url";

export async function openTranscriptionStudio(
	sessionId?: string,
): Promise<void> {
	const params = new URLSearchParams();
	if (sessionId) params.set("transcript", sessionId);
	await chrome.storage.local.set({
		"memorall.workspace.mode": "speech-to-text",
	});
	await chrome.tabs.create({
		url: extensionAppUrl(params.size ? `/?${params}` : "/"),
		active: true,
	});
}

async function offscreen(
	command: Record<string, unknown>,
): Promise<TabTranscriptionResponse> {
	if (command.action === "status") {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});
		if (!contexts.length) return { success: true, session: null };
	}
	await ensureOffscreenDocument();
	const response = (await chrome.runtime.sendMessage({
		...command,
		type: TAB_TRANSCRIPTION_OFFSCREEN,
	})) as TabTranscriptionResponse | undefined;
	if (!response?.success)
		throw new Error(
			response?.error ||
				"The transcription service is unavailable. Try again shortly.",
		);
	return response;
}

/** Called from the extension context menu, which grants the tabCapture user invocation. */
export async function toggleTabTranscription(
	tab: chrome.tabs.Tab,
): Promise<void> {
	if (tab.id === undefined) return;
	try {
		if (!chrome.tabCapture?.getMediaStreamId)
			throw new Error(
				"Tab transcription requires Chrome or Edge 116 or newer.",
			);
		const current = await offscreen({ action: "prepare" });
		if (current.session) {
			if (current.session.tabId !== tab.id)
				throw new Error(
					"Another tab is being transcribed. Stop that recording first.",
				);
			await offscreen({ action: "stop", tabId: tab.id });
		} else {
			const streamId = await chrome.tabCapture.getMediaStreamId({
				targetTabId: tab.id,
			});
			await offscreen({
				action: "start",
				tabId: tab.id,
				streamId,
				title: tab.title,
				url: tab.url,
			});
		}
		// Capture also works without site access; the context menu remains a stop control.
		try {
			try {
				await chrome.tabs.sendMessage(tab.id, { type: TAB_TRANSCRIPTION_SHOW });
			} catch {
				if (await reinjectContentScript(tab.id))
					await chrome.tabs.sendMessage(tab.id, {
						type: TAB_TRANSCRIPTION_SHOW,
					});
			}
		} catch {
			/* No content overlay on restricted pages. */
		}
	} catch (error) {
		createNotification(
			"Tab transcription",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export function registerTabTranscriptionHandler(): void {
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message?.type !== TAB_TRANSCRIPTION) return false;
		const extensionPage =
			sender.id === chrome.runtime.id &&
			sender.url?.startsWith(chrome.runtime.getURL(""));
		const contentTabId =
			sender.id === chrome.runtime.id ? sender.tab?.id : undefined;
		void (async () => {
			if (!extensionPage && contentTabId === undefined)
				throw new Error("Invalid transcription sender");
			const { action } = message;
			if (
				action === "finish-action" &&
				!["summary", "notes", "export", "save", "chat"].includes(
					message.operation,
				)
			)
				throw new Error("Invalid transcript action");
			if (
				![
					"status",
					"list",
					"get",
					"stop",
					"configure",
					"options",
					"summarize",
					"finish-action",
				].includes(action)
			)
				throw new Error("Invalid transcription action");
			if (
				!extensionPage &&
				action !== "status" &&
				action !== "stop" &&
				action !== "configure" &&
				action !== "options" &&
				action !== "finish-action"
			)
				throw new Error("Open Studio to view saved transcripts");
			const result = await offscreen({
				action,
				tabId: extensionPage ? message.tabId : contentTabId,
				sessionId: extensionPage ? message.sessionId : undefined,
				noteStyle: message.noteStyle,
				...(action === "configure"
					? {
							...(message.language !== undefined
								? { language: message.language }
								: {}),
							...(message.translation !== undefined
								? { translation: message.translation }
								: {}),
						}
					: {}),
				...(action === "finish-action"
					? {
							operation:
								message.operation === "chat" ? "export" : message.operation,
						}
					: {}),
			});
			if (action === "finish-action" && message.operation === "chat") {
				if (!result.export)
					throw new Error("Could not prepare the transcript for chat.");
				await chrome.storage.session.set({
					smartSelectContext: JSON.stringify({
						id: `transcript-${Date.now()}`,
						kind: "selection",
						label: result.export.title,
						content: result.export.content,
					}),
				});
				await chrome.storage.local.set({ "memorall.workspace.mode": "chat" });
				await chrome.tabs.create({
					url: extensionAppUrl("/"),
					active: true,
				});
				return { success: true };
			}
			return result;
		})()
			.then(sendResponse)
			.catch((error) =>
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		return true;
	});
	chrome.tabs.onRemoved.addListener((tabId) => {
		// Query an existing owner only; closing an unrelated tab must not create an offscreen document.
		void chrome.runtime
			.sendMessage({
				type: TAB_TRANSCRIPTION_OFFSCREEN,
				action: "stop",
				tabId,
			})
			.catch(() => undefined);
	});
}
