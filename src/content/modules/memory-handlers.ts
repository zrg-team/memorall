import { BACKGROUND_EVENTS } from "@/constants/events";
import {
	extractSelection,
	extractPageContent,
	storeRememberContext,
	sendMessageToBackground,
} from "@/embedded";
import type {
	BackgroundMessage,
	MessageResponse,
	ExtractedSelectionData,
} from "@/embedded/types";

export async function handleRememberThis(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		const extractedData = await extractPageContent();

		if (message.topicId) {
			extractedData.topicId = message.topicId;
		}

		const payload: BackgroundMessage = {
			type: BACKGROUND_EVENTS.CONTENT_EXTRACTED,
			tabId: message.tabId,
			data: extractedData,
		};

		let response: MessageResponse;
		try {
			response = await sendMessageToBackground(payload);
		} catch {
			response = { success: false, error: "No response from background" };
		}

		sendResponse(response);
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Failed to extract content",
		});
	}
}

export async function handleRememberContent(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		if (!message.selectedText) {
			throw new Error("No selected text provided");
		}

		const selectionMetadata = extractSelection(message.selectedText);

		const selectionData: ExtractedSelectionData = {
			selectedText: message.selectedText,
			selectionContext: selectionMetadata.selectionContext,
			url: window.location.href,
			title: document.title,
			sourceMetadata: selectionMetadata,
		};

		const payload: BackgroundMessage = {
			type: BACKGROUND_EVENTS.SELECTION_EXTRACTED,
			tabId: message.tabId,
			data: selectionData,
		};

		let response: MessageResponse;
		try {
			response = await sendMessageToBackground(payload);
		} catch {
			response = { success: false, error: "No response from background" };
		}

		sendResponse(response);
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to extract selection",
		});
	}
}

export function handleLetRemember(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	try {
		storeRememberContext(message.context, message.showTopicSelector);
		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to store context",
		});
	}
}
