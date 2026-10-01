import { BACKGROUND_EVENTS } from "@/constants/events";
import type { MemonChangeBus, MemonChangeEnvelope } from "./types";

/**
 * Runtime messages reach every extension page, so the offscreen document's
 * machines reach the options page without a background relay (which would
 * double every message and wake the service worker for each one).
 */
export function createMemonChangeBus(): MemonChangeBus {
	const listeners = new Set<(message: MemonChangeEnvelope) => void>();
	if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
		return {
			publish: () => undefined,
			subscribe(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			close() {
				listeners.clear();
			},
		};
	}
	const handler = (message: MemonChangeEnvelope & { type?: string }) => {
		if (message?.type !== BACKGROUND_EVENTS.MEMON_MACHINE_CHANGED) return;
		for (const listener of listeners) listener(message);
	};
	chrome.runtime.onMessage.addListener(handler);

	return {
		publish(message) {
			void chrome.runtime
				.sendMessage({
					type: BACKGROUND_EVENTS.MEMON_MACHINE_CHANGED,
					...message,
				})
				.catch(() => undefined);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			listeners.clear();
			chrome.runtime.onMessage.removeListener(handler);
		},
	};
}
