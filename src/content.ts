// Content script for Memorall extension
// Uses modular embedded components structure

import { CONTENT_BACKGROUND_EVENTS } from "./constants/content-background";
import {
	extractSelection,
	extractPageContent,
	storeRememberContext,
	sendMessageToBackground,
	createEmbeddedTopicSelector,
} from "./embedded";
import { createShadcnEmbeddedChatModal } from "./embedded/components/ShadcnEmbeddedChat";
import { handlePDFMessage } from "./embedded/pdf-content-handler";
import type {
	BackgroundMessage,
	MessageResponse,
	ExtractedSelectionData,
} from "./embedded/types";

// Track mouse position for UI positioning
let lastMouseX = 0;
let lastMouseY = 0;

// Track mouse position for context menu positioning
document.addEventListener("contextmenu", (e) => {
	lastMouseX = e.clientX;
	lastMouseY = e.clientY;
});

// Main message listener for background script communications
chrome.runtime.onMessage.addListener(
	async (message: BackgroundMessage, _sender, sendResponse) => {
		try {
			switch (message.type) {
				case CONTENT_BACKGROUND_EVENTS.REMEMBER_THIS:
					await handleRememberThis(message, sendResponse);
					return true;

				case CONTENT_BACKGROUND_EVENTS.REMEMBER_CONTENT:
					await handleRememberContent(message, sendResponse);
					return true;

				case CONTENT_BACKGROUND_EVENTS.LET_REMEMBER:
					handleLetRemember(message, sendResponse);
					return true;

				case CONTENT_BACKGROUND_EVENTS.SHOW_TOPIC_SELECTOR:
					handleShowTopicSelector(message, sendResponse);
					return true;

				case CONTENT_BACKGROUND_EVENTS.SHOW_CHAT_MODAL:
					handleShowChatModal(message, sendResponse);
					return true;

				// PDF-specific handlers
				case CONTENT_BACKGROUND_EVENTS.PDF_EXTRACT_PDF:
				case CONTENT_BACKGROUND_EVENTS.PDF_EXTRACT_PDF_PAGES:
				case CONTENT_BACKGROUND_EVENTS.PDF_SEARCH_PDF:
				case CONTENT_BACKGROUND_EVENTS.PDF_EXPORT_PDF_TEXT:
				case CONTENT_BACKGROUND_EVENTS.PDF_EXPORT_PDF_MARKDOWN:
					handlePDFOperation(message, sendResponse);
					return true;

				default:
					sendResponse({ success: false, error: "Unknown message type" });
					return true;
			}
		} catch (error) {
			console.error(`Failed to handle message ${message.type}:`, error);
			sendResponse({
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return true;
		}
	},
);

// Handle REMEMBER_THIS message - extract full page content
async function handleRememberThis(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		// Extract page content
		const extractedData = await extractPageContent();

		// Include topicId if provided
		if (message.topicId) {
			extractedData.topicId = message.topicId;
		}

		// Send extracted content back to background script
		const payload: BackgroundMessage = {
			type: CONTENT_BACKGROUND_EVENTS.CONTENT_EXTRACTED,
			tabId: message.tabId,
			data: extractedData,
		};

		let response: MessageResponse;
		try {
			response = await sendMessageToBackground(payload);
		} catch (err) {
			// Ignore errors if background is not reachable
			response = { success: false, error: "No response from background" };
		}

		sendResponse(response);
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to extract content",
		});
	}
}

// Handle REMEMBER_CONTENT message - extract selected content
async function handleRememberContent(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		if (!message.selectedText) {
			throw new Error("No selected text provided");
		}

		// Extract selection metadata
		const selectionMetadata = extractSelection(message.selectedText);

		// Prepare selection data
		const selectionData: ExtractedSelectionData = {
			selectedText: message.selectedText,
			selectionContext: selectionMetadata.selectionContext,
			url: window.location.href,
			title: document.title,
			sourceMetadata: selectionMetadata,
		};

		// Send extracted selection back to background script
		const payload: BackgroundMessage = {
			type: CONTENT_BACKGROUND_EVENTS.SELECTION_EXTRACTED,
			tabId: message.tabId,
			data: selectionData,
		};

		let response: MessageResponse;
		try {
			response = await sendMessageToBackground(payload);
		} catch (err) {
			console.error(
				"❌ Failed sending SELECTION_EXTRACTED to background:",
				err,
			);
			response = { success: false, error: "No response from background" };
		}

		sendResponse(response);
	} catch (error) {
		console.error("❌ Selection extraction failed:", error);
		sendResponse({
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to extract selection",
		});
	}
}

// Handle LET_REMEMBER message - store context for popup access
function handleLetRemember(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	try {
		// Store context data for the popup to access
		storeRememberContext(message.context, message.showTopicSelector);
		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Failed to store context",
		});
	}
}

// Handle SHOW_TOPIC_SELECTOR message - display topic selector UI
function handleShowTopicSelector(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	try {
		// Remove any existing selector
		const existingSelector = document.getElementById(
			"memorall-embedded-topic-selector",
		);
		if (existingSelector) {
			existingSelector.remove();
		}

		// Create new topic selector
		createEmbeddedTopicSelector({
			context: message.context || "",
			pageUrl: window.location.href,
			pageTitle: document.title,
			onClose: () => {
				// Cleanup handled by the component itself
			},
		});

		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to show topic selector",
		});
	}
}

// Handle SHOW_CHAT_MODAL message - display chat modal UI
function handleShowChatModal(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	try {
		// Remove any existing chat modal
		const existingModal = document.getElementById(
			"memorall-embedded-chat-modal",
		);
		if (existingModal) {
			existingModal.remove();
		}

		// Create new chat modal
		createShadcnEmbeddedChatModal({
			context: message.context,
			mode: message.mode || "general",
			pageUrl: window.location.href,
			pageTitle: document.title,
			onClose: () => {
				// Cleanup handled by the component itself
			},
		});

		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error ? error.message : "Failed to show chat modal",
		});
	}
}

// Handle PDF operations
function handlePDFOperation(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	(async () => {
		try {
			const result = await handlePDFMessage({
				type: message.type,
				url: message.url || window.location.href,
			});
			sendResponse(result);
		} catch (error) {
			sendResponse({
				success: false,
				error: error instanceof Error ? error.message : "Failed PDF operation",
			});
		}
	})();
}

// Initialize content script
console.log("🚀 Memorall content script loaded on:", window.location.href);
