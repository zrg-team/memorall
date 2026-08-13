import type { StorageChangeBus, StorageChangeMessage } from "./types";

export function createStorageChangeBus(): StorageChangeBus {
	const source = crypto.randomUUID();
	const listeners = new Set<(message: StorageChangeMessage) => void>();
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
	const handler = (
		message: StorageChangeMessage & { type?: string; source?: string },
	) => {
		if (message?.type !== "STORAGE_CHANGED" || message.source === source)
			return;
		for (const listener of listeners) listener(message);
	};
	chrome.runtime.onMessage.addListener(handler);

	return {
		publish(message) {
			void chrome.runtime
				.sendMessage({ type: "STORAGE_CHANGED", source, ...message })
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
