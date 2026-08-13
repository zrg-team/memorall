import type { StorageChangeBus, StorageChangeMessage } from "./types";

export function createStorageChangeBus(): StorageChangeBus {
	const channel =
		typeof BroadcastChannel === "undefined"
			? null
			: new BroadcastChannel("memorall-shared-storage:changes");
	const listeners = new Set<(message: StorageChangeMessage) => void>();
	const handler = (event: MessageEvent<StorageChangeMessage>) => {
		if (!event.data) return;
		for (const listener of listeners) listener(event.data);
	};
	channel?.addEventListener("message", handler);

	return {
		publish(message) {
			channel?.postMessage(message);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			listeners.clear();
			channel?.removeEventListener("message", handler);
			channel?.close();
		},
	};
}
