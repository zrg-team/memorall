/**
 * Content script entry point.
 *
 * Import order here is load-bearing. Everything the agent needs to *read* a page
 * — snapshot, DOM query, wait, fetch-image — is imported statically and its
 * listener is registered before anything else runs. The embedded chat UI, the
 * co-agent overlay and the activity trackers are pulled in dynamically
 * afterwards.
 *
 * The reason is a failure mode that looks nothing like its cause. ES modules
 * execute every static import before the module body, so when this file
 * imported the whole embedded React app at the top, a single module-level throw
 * anywhere in that graph meant `chrome.runtime.onMessage.addListener` at the
 * bottom never ran. The tab then had no listener at all, every
 * `chrome.tabs.sendMessage` failed with "Receiving end does not exist", and
 * `web_open` reported "Content script unavailable for <url>" until it timed out
 * — on a page that had loaded perfectly well. Whether it happened depended on
 * the page, which is what made it so hard to pin down.
 *
 * Splitting it this way means a page that breaks the UI costs us the UI, not the
 * ability to read the page.
 */

import {
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	CO_AGENT_CONTENT_COMMAND_SOURCE,
	type CoAgentContentCommandResponse,
	isCoAgentBrowserCommandResponse,
	isCoAgentContentCommandRequest,
} from "@/services/co-agent";
import {
	isWebContentCommandRequest,
	type WebContentCommandResponse,
} from "@/services/web-browser";
import { BACKGROUND_EVENTS } from "./constants/events";
import {
	loadActivityTracker,
	loadEmbeddedUi,
} from "./content/load-embedded-ui";
import { handleWebContentCommand } from "./content/modules/web-commands";
import type { BackgroundMessage, MessageResponse } from "./embedded/types";
import { isJobNotificationMessage } from "./services/background-jobs/bridges/types";
import { logError, logInfo } from "./utils/logger";

type ContentSendResponse = (
	response:
		| MessageResponse
		| WebContentCommandResponse
		| CoAgentContentCommandResponse,
) => void;

// ── Deferred modules ──────────────────────────────────────────────────────────
//
// Loaded on demand so a throw inside them cannot stop the listener below from
// being registered. Each failure answers the message it was handling instead of
// leaving the sender waiting for a reply that never comes.

// The UI is a separate ES module build entry, fetched by URL — see
// ./content/load-embedded-ui for why a bundler-managed dynamic import cannot
// reach a content script's isolated world. The loader takes the resolver from
// here because only this file may reach for a Chrome API.
const resolveAssetUrl = (path: string) => chrome.runtime.getURL(path);

const loadUiHandlers = () =>
	loadEmbeddedUi(resolveAssetUrl).then((module) => module.uiHandlers);
const loadMemoryHandlers = () =>
	loadEmbeddedUi(resolveAssetUrl).then((module) => module.memoryHandlers);
const loadCoAgent = () =>
	loadEmbeddedUi(resolveAssetUrl).then((module) => module.coAgent);

const reportUnavailable = (
	sendResponse: ContentSendResponse,
	feature: string,
) => {
	return (error: unknown) => {
		logError(`Memorall content script could not load ${feature}:`, error);
		sendResponse({
			success: false,
			error: `${feature} is unavailable on this page.`,
		} as MessageResponse);
	};
};

// ── Message listener ──────────────────────────────────────────────────────────

const messageListener = (
	rawMessage: unknown,
	_sender: chrome.runtime.MessageSender,
	sendResponse: ContentSendResponse,
): boolean => {
	if (isJobNotificationMessage(rawMessage)) return false;

	// Page reading first, and from a statically imported module: this is the path
	// web_open depends on, so it must not rely on anything deferred.
	if (isWebContentCommandRequest(rawMessage)) {
		void handleWebContentCommand(rawMessage).then(sendResponse);
		return true;
	}

	if (isCoAgentContentCommandRequest(rawMessage)) {
		void loadCoAgent()
			.then((module) => module.handleCoAgentContentCommand(rawMessage))
			.then(sendResponse)
			.catch(reportUnavailable(sendResponse, "the co-agent"));
		return true;
	}

	const message = rawMessage as BackgroundMessage;

	switch (message.type) {
		case "web-tool:tab-capture":
			sendResponse({
				success: true,
				url: window.location.href,
				title: document.title || "",
				html:
					document.documentElement?.outerHTML || document.body?.innerHTML || "",
				text:
					document.body?.innerText ||
					document.documentElement?.textContent ||
					"",
			} as MessageResponse);
			return true;

		case BACKGROUND_EVENTS.REMEMBER_THIS:
			void loadMemoryHandlers()
				.then((module) => module.handleRememberThis(message, sendResponse))
				.catch(reportUnavailable(sendResponse, "saving this page"));
			return true;

		case BACKGROUND_EVENTS.REMEMBER_CONTENT:
			void loadMemoryHandlers()
				.then((module) => module.handleRememberContent(message, sendResponse))
				.catch(reportUnavailable(sendResponse, "saving this selection"));
			return true;

		case BACKGROUND_EVENTS.LET_REMEMBER:
			void loadMemoryHandlers()
				.then((module) => module.handleLetRemember(message, sendResponse))
				.catch(reportUnavailable(sendResponse, "saving this page"));
			return true;

		case BACKGROUND_EVENTS.SHOW_TOPIC_SELECTOR:
			void loadUiHandlers()
				.then((module) => module.handleShowTopicSelector(message, sendResponse))
				.catch(reportUnavailable(sendResponse, "the topic selector"));
			return true;

		case BACKGROUND_EVENTS.SHOW_CHAT_MODAL:
			void loadUiHandlers()
				.then((module) => module.handleShowChatModal(message, sendResponse))
				.catch(reportUnavailable(sendResponse, "the chat panel"));
			return true;

		case BACKGROUND_EVENTS.SHOW_CO_AGENT:
			void loadUiHandlers()
				.then((module) => module.handleShowCoAgent(sendResponse))
				.catch(reportUnavailable(sendResponse, "the co-agent"));
			return true;

		case BACKGROUND_EVENTS.HIDE_CO_AGENT:
			void loadUiHandlers()
				.then((module) => module.handleHideCoAgent(sendResponse))
				.catch(reportUnavailable(sendResponse, "the co-agent"));
			return true;

		case BACKGROUND_EVENTS.CO_AGENT_GET_TRACE:
			void loadCoAgent()
				.then((module) =>
					module.handleCoAgentContentCommand({
						source: CO_AGENT_CONTENT_COMMAND_SOURCE,
						type: "co-agent:get-trace",
					}),
				)
				.then(sendResponse)
				.catch(reportUnavailable(sendResponse, "the co-agent"));
			return true;

		case BACKGROUND_EVENTS.SHOW_IMAGE_SELECTOR:
			void loadUiHandlers()
				.then((module) => module.handleShowImageSelector(message, sendResponse))
				.catch(reportUnavailable(sendResponse, "the image selector"));
			return true;

		case BACKGROUND_EVENTS.ACTIVATE_SMART_SELECTOR:
			void loadUiHandlers()
				.then((module) => module.handleActivateSmartSelector(sendResponse))
				.catch(reportUnavailable(sendResponse, "the selector"));
			return true;

		default:
			sendResponse({ success: false, error: "Unknown message type" });
			return true;
	}
};

// ── Init ──────────────────────────────────────────────────────────────────────
//
// Registered before any deferred module is touched, so the tab always has a
// listener even if everything below this line fails.

chrome.runtime.onMessage.addListener(messageListener);

logInfo("🚀 Memorall content script loaded on:", window.location.href);

document.addEventListener("contextmenu", () => {
	// Mouse position tracked for UI positioning in embedded components
});

// Side-effect only: registers its own activity-tracking listener.
void loadActivityTracker(resolveAssetUrl).catch((error) => {
	logError("Memorall activity tracking is unavailable on this page:", error);
});

async function restoreCoAgentIfActiveInThisTab(): Promise<void> {
	try {
		const response = await chrome.runtime.sendMessage({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "get-active",
		});
		if (!isCoAgentBrowserCommandResponse(response) || !response.success) return;
		const { setCoAgentActive } = await loadUiHandlers();
		await setCoAgentActive(true);
	} catch {
		// Co-agent is either inactive or active in another tab.
	}
}

void restoreCoAgentIfActiveInThisTab();

export default function main() {
	return () => {
		chrome.runtime.onMessage.removeListener(messageListener);
		logInfo("🧹 Memorall content script cleaned up");
	};
}
