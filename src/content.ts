import { BACKGROUND_EVENTS } from "./constants/events";
import { isJobNotificationMessage } from "./services/background-jobs/bridges/types";
import "./embedded/activity-tracker";
import { handleWebContentCommand } from "./content/modules/web-commands";
import {
	handleRememberThis,
	handleRememberContent,
	handleLetRemember,
} from "./content/modules/memory-handlers";
import {
	handleShowTopicSelector,
	handleShowChatModal,
	handleShowImageSelector,
	handleActivateSmartSelector,
	handleShowCoAgent,
	handleHideCoAgent,
	setCoAgentActive,
} from "./content/modules/ui-handlers";
import {
	isWebContentCommandRequest,
	type WebContentCommandResponse,
} from "@/services/web-browser";
import {
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	CO_AGENT_CONTENT_COMMAND_SOURCE,
	isCoAgentBrowserCommandResponse,
	isCoAgentContentCommandRequest,
	type CoAgentContentCommandResponse,
} from "@/services/co-agent";
import { handleCoAgentContentCommand } from "@/embedded/pages/CoAgent";
import type { BackgroundMessage, MessageResponse } from "./embedded/types";
import { logInfo } from "./utils/logger";

// ── Message listener ──────────────────────────────────────────────────────────

const messageListener = (
	rawMessage: unknown,
	_sender: chrome.runtime.MessageSender,
	sendResponse: (
		response:
			| MessageResponse
			| WebContentCommandResponse
			| CoAgentContentCommandResponse,
	) => void,
): boolean => {
	if (isJobNotificationMessage(rawMessage)) return false;

	if (isWebContentCommandRequest(rawMessage)) {
		void handleWebContentCommand(rawMessage).then(sendResponse);
		return true;
	}

	if (isCoAgentContentCommandRequest(rawMessage)) {
		void handleCoAgentContentCommand(rawMessage).then(sendResponse);
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
			void handleRememberThis(message, sendResponse);
			return true;

		case BACKGROUND_EVENTS.REMEMBER_CONTENT:
			void handleRememberContent(message, sendResponse);
			return true;

		case BACKGROUND_EVENTS.LET_REMEMBER:
			handleLetRemember(message, sendResponse);
			return true;

		case BACKGROUND_EVENTS.SHOW_TOPIC_SELECTOR:
			handleShowTopicSelector(message, sendResponse);
			return true;

		case BACKGROUND_EVENTS.SHOW_CHAT_MODAL:
			void handleShowChatModal(message, sendResponse);
			return true;

		case BACKGROUND_EVENTS.SHOW_CO_AGENT:
			void handleShowCoAgent(sendResponse);
			return true;

		case BACKGROUND_EVENTS.HIDE_CO_AGENT:
			handleHideCoAgent(sendResponse);
			return true;

		case BACKGROUND_EVENTS.CO_AGENT_GET_TRACE:
			void handleCoAgentContentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:get-trace",
			}).then(sendResponse);
			return true;

		case BACKGROUND_EVENTS.SHOW_IMAGE_SELECTOR:
			handleShowImageSelector(message, sendResponse);
			return true;

		case BACKGROUND_EVENTS.ACTIVATE_SMART_SELECTOR:
			void handleActivateSmartSelector(sendResponse);
			return true;

		default:
			sendResponse({ success: false, error: "Unknown message type" });
			return true;
	}
};

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(messageListener);

document.addEventListener("contextmenu", () => {
	// Mouse position tracked for UI positioning in embedded components
});

logInfo("🚀 Memorall content script loaded on:", window.location.href);

async function restoreCoAgentIfActiveInThisTab(): Promise<void> {
	try {
		const response = await chrome.runtime.sendMessage({
			source: CO_AGENT_BROWSER_COMMAND_SOURCE,
			command: "get-active",
		});
		if (!isCoAgentBrowserCommandResponse(response) || !response.success) return;
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
