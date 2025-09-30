// Background job message relay service
// Handles relaying job notification messages from offscreen to content scripts
// Chrome extension architecture requires background script to relay messages to content scripts

import { logInfo, logError } from "@/utils/logger";
import type { JobNotificationMessage } from "../services/background-jobs/bridges/types";

export interface TabInfo {
	id: number;
	url?: string;
}

export interface MessageRelayOptions {
	targetContexts?: Array<"embedded" | "content">;
	tabFilter?: (tab: TabInfo) => boolean;
}

/**
 * Service for relaying job notification messages from offscreen to content scripts
 * Handles the Chrome extension architecture limitation where content scripts
 * cannot directly receive chrome.runtime.sendMessage from offscreen contexts
 */
export class BackgroundJobMessageForwarder {
	private static instance: BackgroundJobMessageForwarder;
	private isInitialized = false;

	private constructor() {}

	static getInstance(): BackgroundJobMessageForwarder {
		if (!BackgroundJobMessageForwarder.instance) {
			BackgroundJobMessageForwarder.instance =
				new BackgroundJobMessageForwarder();
		}
		return BackgroundJobMessageForwarder.instance;
	}

	/**
	 * Initialize the message relay service
	 * Sets up chrome.runtime.onMessage listener for JOB_NOTIFICATION_BRIDGE messages
	 */
	initialize(): void {
		if (this.isInitialized) {
			return;
		}

		if (typeof chrome === "undefined" || !chrome.runtime) {
			logError("Chrome runtime not available for message relay");
			return;
		}

		chrome.runtime.onMessage.addListener(
			(
				message: unknown,
				sender: chrome.runtime.MessageSender,
				sendResponse: (response?: unknown) => void,
			) => {
				this.handleRuntimeMessage(message, sender, sendResponse);
			},
		);

		this.isInitialized = true;
		logInfo("🔄 Background job message relay initialized");
	}

	/**
	 * Handle incoming chrome.runtime messages
	 * Relays JOB_NOTIFICATION_BRIDGE messages and JOB_PROGRESS messages to content scripts
	 */
	private handleRuntimeMessage(
		message: unknown,
		sender: chrome.runtime.MessageSender,
		sendResponse: (response?: unknown) => void,
	): void {
		// Handle JOB_NOTIFICATION_BRIDGE messages
		if (this.isJobNotificationBridgeMessage(message)) {
			const { jobMessage } = message;

			// Only relay messages that should go to content scripts
			if (!this.shouldRelayToContentScripts(jobMessage, sender)) {
				return;
			}

			// Relay the entire JOB_NOTIFICATION_BRIDGE message to content scripts
			this.relayToContentScripts(message)
				.then(() => {
					sendResponse({ success: true });
				})
				.catch((error) => {
					logError("Failed to relay message to content scripts:", error);
					sendResponse({ success: false, error: error.message });
				});
			return;
		}
	}

	/**
	 * Type guard to check if message is a JOB_NOTIFICATION_BRIDGE message
	 */
	private isJobNotificationBridgeMessage(message: unknown): message is {
		type: "JOB_NOTIFICATION_BRIDGE";
		jobMessage: JobNotificationMessage;
	} {
		return (
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "JOB_NOTIFICATION_BRIDGE" &&
			"jobMessage" in message &&
			typeof message.jobMessage === "object" &&
			message.jobMessage !== null
		);
	}

	/**
	 * Type guard to check if message is an JOB_PROGRESS message
	 */
	private isUpdateJobProgressMessage(message: unknown): message is {
		type: "JOB_PROGRESS";
		jobId: string;
		progress: any;
	} {
		return (
			typeof message === "object" &&
			message !== null &&
			"type" in message &&
			message.type === "JOB_PROGRESS" &&
			"jobId" in message &&
			typeof (message as any).jobId === "string" &&
			"progress" in message
		);
	}

	/**
	 * Determine if a job message should be relayed to content scripts
	 */
	private shouldRelayToContentScripts(
		jobMessage: JobNotificationMessage,
		sender: chrome.runtime.MessageSender,
	): boolean {
		// Only relay messages from offscreen context
		if (!sender.url?.includes("offscreen.html")) {
			return false;
		}

		// Only relay if destination is "all" or "embedded"
		if (
			jobMessage.destination &&
			jobMessage.destination !== "all" &&
			jobMessage.destination !== "embedded"
		) {
			return false;
		}

		return true;
	}

	/**
	 * Relay job notification bridge message or JOB_PROGRESS message to all content scripts
	 */
	private async relayToContentScripts(
		message:
			| {
					type: "JOB_NOTIFICATION_BRIDGE";
					jobMessage: JobNotificationMessage;
			  }
			| {
					type: "JOB_PROGRESS";
					jobId: string;
					progress: unknown;
			  },
		options: MessageRelayOptions = {},
	): Promise<void> {
		const { tabFilter } = options;

		try {
			// Get all tabs
			const tabs = await chrome.tabs.query({});

			// Filter tabs that can receive content script messages
			const targetTabs = tabs.filter((tab) => {
				if (!tab.id || !tab.url) {
					return false;
				}

				// Skip chrome:// and extension pages
				if (
					tab.url.startsWith("chrome://") ||
					tab.url.startsWith("chrome-extension://")
				) {
					return false;
				}

				// Apply custom tab filter if provided
				if (tabFilter && !tabFilter({ id: tab.id, url: tab.url })) {
					return false;
				}

				return true;
			});

			// Send message to each target tab
			const relayPromises = targetTabs.map(async (tab) => {
				try {
					if (!tab.id) {
						return;
					}
					await chrome.tabs.sendMessage(tab.id, message);
				} catch (error) {
					// Tab might not have content script injected - this is normal
					// Only log as debug, not error
					if (
						error instanceof Error &&
						error.message.includes("Could not establish connection")
					) {
						// Silently ignore - tab doesn't have content script
						return;
					}
					logError(`Failed to send message to tab ${tab.id}:`, error);
				}
			});

			await Promise.allSettled(relayPromises);
		} catch (error) {
			logError("Failed to query tabs for message relay:", error);
			throw error;
		}
	}

	/**
	 * Get relay service status
	 */
	getStatus(): { initialized: boolean } {
		return {
			initialized: this.isInitialized,
		};
	}
}

// Export singleton instance
export const backgroundJobMessageForwarder =
	BackgroundJobMessageForwarder.getInstance();
