/**
 * Port Bridge for Chrome Extension
 *
 * Relays Port connections from popup/UI to offscreen document.
 * Required because chrome.runtime.connect() from popup goes to background script,
 * not directly to offscreen documents.
 *
 * Architecture:
 * Popup --[Port]--> Background (this bridge) --[Port]--> Offscreen
 */

import { logInfo, logError, logWarn } from "@/utils/logger";

interface PortPair {
	popupPort: chrome.runtime.Port;
	offscreenPort: chrome.runtime.Port;
}

export class PortBridge {
	private activeBridges = new Map<string, PortPair>();

	/**
	 * Initialize the Port bridge
	 * Listens for Port connections from popup and relays them to offscreen
	 */
	initialize({
		proxyOptions,
	}: {
		proxyOptions: {
			channelName: string;
		};
	}): void {
		logInfo("🌉 RPC Port bridge initializing...", {
			channelName: proxyOptions.channelName,
		});

		chrome.runtime.onConnect.addListener((popupPort) => {
			logInfo("🔍 RPC PORT BRIDGE: onConnect event fired", {
				portName: popupPort.name,
				expectedChannel: proxyOptions.channelName,
				hasSender: !!popupPort.sender,
				senderInfo: popupPort.sender
					? {
							id: popupPort.sender.id,
							url: popupPort.sender.url,
							origin: popupPort.sender.origin,
						}
					: null,
				timestamp: new Date().toISOString(),
			});

			// Only handle pglite-rpc connections
			if (popupPort.name !== proxyOptions.channelName) {
				logInfo("🔍 PORT BRIDGE: Ignoring - channel name mismatch", {
					received: popupPort.name,
					expected: proxyOptions.channelName,
				});
				return;
			}

			// Only handle connections from popup, not from background itself
			// popupPort.sender will be undefined if the connection is from the same context (background)
			if (!popupPort.sender) {
				logInfo(
					"🔍 PORT BRIDGE: Ignoring - no sender (background self-connection)",
				);
				return;
			}

			logInfo("🌉 Port bridge: Popup connected, creating bridge to offscreen", {
				portName: popupPort.name,
				timestamp: new Date().toISOString(),
			});

			try {
				logInfo(
					"🔍 PORT BRIDGE: Calling chrome.runtime.connect to create offscreen port...",
					{
						channelName: popupPort.name,
						timestamp: new Date().toISOString(),
					},
				);

				// Create matching Port connection to offscreen document
				const offscreenPort = chrome.runtime.connect({ name: popupPort.name });

				logInfo("🔍 PORT BRIDGE: Offscreen port created successfully", {
					portName: offscreenPort.name,
					hasPort: !!offscreenPort,
					timestamp: new Date().toISOString(),
				});

				// Store the bridge
				const bridgeId = `${popupPort.name}-${Date.now()}`;
				this.activeBridges.set(bridgeId, { popupPort, offscreenPort });

				// Set up bidirectional message relay
				this.setupRelay(bridgeId, popupPort, offscreenPort);

				logInfo("✅ Port bridge established", {
					bridgeId,
					portName: popupPort.name,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				logError("❌ Failed to create port bridge to offscreen:", error);
				// Disconnect popup port if offscreen connection fails
				try {
					popupPort.disconnect();
				} catch {}
			}
		});

		logInfo("🌉 Port bridge initialized - ready to relay popup ↔ offscreen");
	}

	/**
	 * Set up bidirectional message relay between popup and offscreen ports.
	 *
	 * When the offscreen port disconnects (e.g. the RPC handler isn't registered
	 * yet because the offscreen document is still initialising) we retry the
	 * offscreen connection with exponential backoff instead of closing the popup
	 * port.  This prevents the client-side reconnect loop that arises when the
	 * popup keeps reconnecting because we keep kicking it out.
	 */
	private setupRelay(
		bridgeId: string,
		popupPort: chrome.runtime.Port,
		offscreenPort: chrome.runtime.Port,
	): void {
		const OFFSCREEN_BACKOFF_INIT_MS = 200;
		const OFFSCREEN_BACKOFF_MAX_MS = 5000;
		const OFFSCREEN_MAX_RETRIES = 20;

		let currentOffscreenPort = offscreenPort;
		let popupDisconnected = false;
		// Requests can be posted before the offscreen RPC listener is registered.
		// Edge disconnects that temporary port, so retain every unanswered RPC and
		// replay it on the replacement port. The offscreen handler deduplicates by
		// request id, making replay safe even when a response races a disconnect.
		const pendingMessages = new Map<number, unknown>();

		const getMessageId = (message: unknown): number | null => {
			if (typeof message !== "object" || message === null) return null;
			const id = (message as { id?: unknown }).id;
			return typeof id === "number" ? id : null;
		};

		const postToOffscreen = (
			oPort: chrome.runtime.Port,
			message: unknown,
		): void => {
			try {
				oPort.postMessage(message);
			} catch (error) {
				// Keep the request buffered. The disconnect/reconnect path will retry it.
				logWarn("Failed to relay message from popup to offscreen:", error);
			}
		};

		const replayPendingMessages = (oPort: chrome.runtime.Port): void => {
			if (pendingMessages.size === 0) return;
			logInfo("🌉 Port bridge: replaying pending RPC requests", {
				bridgeId,
				count: pendingMessages.size,
			});
			for (const message of pendingMessages.values()) {
				postToOffscreen(oPort, message);
			}
		};

		// Relay messages from popup → current offscreen port
		const relayToOffscreen = (message: unknown) => {
			const id = getMessageId(message);
			if (id !== null) pendingMessages.set(id, message);
			postToOffscreen(currentOffscreenPort, message);
		};
		popupPort.onMessage.addListener(relayToOffscreen);

		// Relay messages from offscreen → popup
		const relayToPopup = (message: unknown) => {
			const id = getMessageId(message);
			if (id !== null) pendingMessages.delete(id);
			try {
				popupPort.postMessage(message);
			} catch (error) {
				logWarn("Failed to relay message from offscreen to popup:", error);
			}
		};

		// Tear down everything when the popup side goes away
		popupPort.onDisconnect.addListener(() => {
			logInfo("🌉 Port bridge: popup disconnected", { bridgeId });
			popupDisconnected = true;
			pendingMessages.clear();
			try {
				currentOffscreenPort.disconnect();
			} catch {}
			this.activeBridges.delete(bridgeId);
		});

		// Attach listeners to an offscreen port and handle its disconnect with retry
		const attachOffscreen = (oPort: chrome.runtime.Port, attempt: number) => {
			oPort.onMessage.addListener(relayToPopup);

			oPort.onDisconnect.addListener(() => {
				if (popupDisconnected) return; // popup already gone, nothing to do

				const err = chrome.runtime.lastError;
				logInfo("🌉 Port bridge: offscreen disconnected, will retry", {
					bridgeId,
					attempt,
					error: err?.message,
				});

				if (attempt >= OFFSCREEN_MAX_RETRIES) {
					logError(
						"❌ Port bridge: max offscreen retries reached, closing popup port",
						{ bridgeId },
					);
					try {
						popupPort.disconnect();
					} catch {}
					this.activeBridges.delete(bridgeId);
					return;
				}

				// Exponential backoff retry — popup stays connected
				const delay = Math.min(
					OFFSCREEN_BACKOFF_INIT_MS * Math.pow(2, attempt),
					OFFSCREEN_BACKOFF_MAX_MS,
				);
				logInfo(`🔄 Port bridge: retrying offscreen in ${delay}ms`, {
					bridgeId,
					attempt: attempt + 1,
				});

				setTimeout(() => {
					if (popupDisconnected) return;
					try {
						const newPort = chrome.runtime.connect({ name: popupPort.name });
						currentOffscreenPort = newPort;
						attachOffscreen(newPort, attempt + 1);
						replayPendingMessages(newPort);
					} catch (connectErr) {
						logError(
							"❌ Port bridge: failed to reconnect to offscreen:",
							connectErr,
						);
						try {
							popupPort.disconnect();
						} catch {}
						this.activeBridges.delete(bridgeId);
					}
				}, delay);
			});
		};

		attachOffscreen(offscreenPort, 0);
	}

	/**
	 * Get number of active port bridges
	 */
	getActiveBridgeCount(): number {
		return this.activeBridges.size;
	}
}

// Singleton instance
export const portBridge = new PortBridge();
