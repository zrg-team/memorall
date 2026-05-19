import { BACKGROUND_EVENTS } from "@/constants/events";
import {
	sendMessageToBackground,
	createEmbeddedTopicSelector,
	extractReadableContent,
	extractViewportContent,
	extractViewportHTMLStructure,
	extractFullPageHTMLStructure,
	createImageSelectorOverlay,
} from "@/embedded";
import { createEmbeddedContextItem } from "@/embedded/context-items";
import { createEmbeddedChatModal } from "@/embedded/pages/EmbeddedChat";
import {
	createStandaloneSmartSelectOverlay,
	type SmartSelectAction,
} from "@/embedded/components/SmartSelectOverlay";
import {
	createCoAgentOverlay,
	destroyCoAgentOverlay,
} from "@/embedded/pages/CoAgent";
import { createFolderPickerOverlay } from "@/embedded/components/FolderPickerOverlay";
import type {
	BackgroundMessage,
	EmbeddedContextItem,
	MessageResponse,
} from "@/embedded/types";

// ── Co-agent ──────────────────────────────────────────────────────────────────

export async function setCoAgentActive(enabled: boolean): Promise<void> {
	if (enabled) {
		createCoAgentOverlay();
		try {
			await sendMessageToBackground({
				type: BACKGROUND_EVENTS.CO_AGENT_SET_ACTIVE,
				url: window.location.href,
				contextData: {
					pageUrl: window.location.href,
					pageTitle: document.title,
					timestamp: new Date().toISOString(),
				},
			});
		} catch {
			// Background activation is best-effort; the visible overlay can still run.
		}
		return;
	}

	destroyCoAgentOverlay();
	try {
		await sendMessageToBackground({
			type: BACKGROUND_EVENTS.HIDE_CO_AGENT,
			url: window.location.href,
		});
	} catch {
		// Ignore background cleanup failures.
	}
}

export async function handleShowCoAgent(
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		await setCoAgentActive(true);
		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : "Failed to show co-agent",
		});
	}
}

export function handleHideCoAgent(
	sendResponse: (response: MessageResponse) => void,
): void {
	destroyCoAgentOverlay();
	sendResponse({ success: true });
}

// ── Topic selector ────────────────────────────────────────────────────────────

export function handleShowTopicSelector(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	try {
		document.getElementById("memorall-embedded-topic-selector")?.remove();

		createEmbeddedTopicSelector({
			context: message.context || "",
			pageUrl: window.location.href,
			pageTitle: document.title,
			onClose: () => {},
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

// ── Chat modal ────────────────────────────────────────────────────────────────

export async function handleShowChatModal(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		document.getElementById("memorall-embedded-chat-modal")?.remove();

		if (message.coAgentEnabled) {
			await setCoAgentActive(true);
		}

		const contextOptions: EmbeddedContextItem[] = [];

		if (message.selectedText?.trim()) {
			contextOptions.push(
				createEmbeddedContextItem({
					kind: "selection",
					label: "Selected text",
					content: message.selectedText,
				}),
			);
		}

		try {
			const viewportContent = extractViewportContent();
			if (viewportContent.trim()) {
				contextOptions.push(
					createEmbeddedContextItem({
						kind: "viewport",
						label: "Visible content",
						content: viewportContent,
					}),
				);
			}
		} catch {
			// Ignore
		}

		try {
			const viewportHTML = extractViewportHTMLStructure();
			if (viewportHTML.trim()) {
				contextOptions.push(
					createEmbeddedContextItem({
						kind: "viewport_html",
						label: "Visible HTML",
						content: viewportHTML,
					}),
				);
			}
		} catch {
			// Ignore
		}

		try {
			const fullPageData = await extractReadableContent();
			const fullContent =
				fullPageData.textContent ||
				fullPageData.content ||
				document.body.innerText ||
				"";
			if (fullContent.trim()) {
				contextOptions.push(
					createEmbeddedContextItem({
						kind: "full_page",
						label: "Page text",
						content: fullContent,
					}),
				);
			}
		} catch {
			const fallbackText = document.body.innerText || "";
			if (fallbackText.trim()) {
				contextOptions.push(
					createEmbeddedContextItem({
						kind: "full_page",
						label: "Page text",
						content: fallbackText,
					}),
				);
			}
		}

		try {
			const fullPageHTML = extractFullPageHTMLStructure();
			if (fullPageHTML.trim()) {
				contextOptions.push(
					createEmbeddedContextItem({
						kind: "full_page_html",
						label: "Page HTML",
						content: fullPageHTML,
					}),
				);
			}
		} catch {
			// Ignore
		}

		contextOptions.push(
			createEmbeddedContextItem({
				kind: "viewport_screenshot",
				label: "Visible image",
				content: "",
			}),
		);

		contextOptions.push(
			createEmbeddedContextItem({
				kind: "screenshot",
				label: "Full page image",
				content: "",
			}),
		);

		createEmbeddedChatModal({
			mode: message.mode || "general",
			displayMode: message.displayMode,
			coAgentEnabled: Boolean(message.coAgentEnabled),
			pageUrl: window.location.href,
			pageTitle: document.title,
			contextOptions,
			onCoAgentToggle: (enabled) => {
				void setCoAgentActive(enabled);
			},
			onClose: () => {},
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

// ── Image selector ────────────────────────────────────────────────────────────

export function handleShowImageSelector(
	message: BackgroundMessage,
	sendResponse: (response: MessageResponse) => void,
): void {
	try {
		document.getElementById("memorall-image-selector-container")?.remove();

		createImageSelectorOverlay(
			async (selectedImageData) => {
				document.getElementById("memorall-embedded-chat-modal")?.remove();

				createEmbeddedChatModal({
					mode: "general",
					pageUrl: window.location.href,
					pageTitle: document.title,
					contextOptions: [
						createEmbeddedContextItem({
							kind: "selected_image",
							label: "Selected region",
							content: selectedImageData,
						}),
					],
					onClose: () => {},
				});
			},
			() => {},
		);

		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to show image selector",
		});
	}
}

// ── Smart selector ────────────────────────────────────────────────────────────

export async function handleActivateSmartSelector(
	sendResponse: (response: MessageResponse) => void,
): Promise<void> {
	try {
		document.getElementById("memorall-smart-select-container")?.remove();

		createStandaloneSmartSelectOverlay(
			(item, action: SmartSelectAction) => {
				if (action === "open-chat") {
					document.getElementById("memorall-embedded-chat-modal")?.remove();
					createEmbeddedChatModal({
						mode: "general",
						pageUrl: window.location.href,
						pageTitle: document.title,
						contextOptions: [item],
						onClose: () => {},
					});
				} else if (action === "open-full-chat") {
					void sendMessageToBackground({
						type: BACKGROUND_EVENTS.OPEN_FULL_CHAT_WITH_CONTEXT,
						context: JSON.stringify(item),
					});
				} else {
					createFolderPickerOverlay(item, () => {}, () => {});
				}
			},
			() => {},
		);

		sendResponse({ success: true });
	} catch (error) {
		sendResponse({
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to activate smart selector",
		});
	}
}
