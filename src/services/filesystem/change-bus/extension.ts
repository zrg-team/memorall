import { BACKGROUND_EVENTS } from "@/constants/events";
import type { FilesystemChangeBus, FilesystemChangeEnvelope } from "./types";

export function createFilesystemChangeBus(): FilesystemChangeBus {
	const listeners = new Set<(message: FilesystemChangeEnvelope) => void>();
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
	const handler = (message: FilesystemChangeEnvelope & { type?: string }) => {
		if (message?.type !== BACKGROUND_EVENTS.FILESYSTEM_CHANGED) return;
		for (const listener of listeners) listener(message);
	};
	chrome.runtime.onMessage.addListener(handler);

	return {
		publish(message) {
			void chrome.runtime
				.sendMessage({
					type: BACKGROUND_EVENTS.FILESYSTEM_CHANGED,
					...message,
					relayedByBackground: false,
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
