import type { BackgroundMessage, MessageResponse } from "./types";

// Send message to background script with typed response
export async function sendMessageToBackground<T = MessageResponse>(
	message: BackgroundMessage,
): Promise<T> {
	try {
		const response = await chrome.runtime.sendMessage(message);
		return response as T;
	} catch (error) {
		console.error("Failed to send message to background:", error);
		throw error;
	}
}

// Store context data for remember functionality
export function storeRememberContext(
	context?: string,
	showTopicSelector?: boolean,
): void {
	const contextData = {
		context,
		pageUrl: window.location.href,
		pageTitle: document.title,
		timestamp: new Date().toISOString(),
	};

	// Store in session storage for the popup to access
	try {
		const storageData: Record<string, unknown> = {
			rememberContext: contextData,
		};
		if (showTopicSelector) {
			storageData.showTopicSelector = true;
		}
		chrome.storage?.session?.set?.(storageData);
	} catch (error) {
		console.error("Failed to store remember context:", error);
	}
}

// Get topics from background for selector
export async function getTopicsForSelector(): Promise<
	Array<{ id: string; name: string; description?: string }>
> {
	try {
		const response = await sendMessageToBackground({
			type: "GET_TOPICS_FOR_SELECTOR",
		});

		if (response.success && response.topics) {
			return response.topics;
		} else {
			throw new Error(response.error || "No topics found");
		}
	} catch (error) {
		console.error("Failed to load topics:", error);
		throw error;
	}
}

// Send content with topic selection to background
export async function sendContentWithTopic(
	context: string,
	pageUrl: string,
	pageTitle: string,
	topicId: string,
): Promise<MessageResponse> {
	return sendMessageToBackground({
		type: "REMEMBER_CONTENT_WITH_TOPIC",
		context,
		url: pageUrl,
		topicId,
		contextData: {
			context,
			pageUrl,
			pageTitle,
			timestamp: new Date().toISOString(),
		},
	});
}
