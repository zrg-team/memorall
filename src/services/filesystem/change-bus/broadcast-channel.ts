import type { FilesystemChangeBus, FilesystemChangeEnvelope } from "./types";

export function createFilesystemChangeBus(): FilesystemChangeBus {
	const channel =
		typeof BroadcastChannel === "undefined"
			? null
			: new BroadcastChannel("memorall-filesystem:changes");
	const listeners = new Set<(message: FilesystemChangeEnvelope) => void>();
	const handler = (event: MessageEvent<FilesystemChangeEnvelope>) => {
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
