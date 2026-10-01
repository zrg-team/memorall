import type { MemonChangeBus, MemonChangeEnvelope } from "./types";

export function createMemonChangeBus(): MemonChangeBus {
	const channel =
		typeof BroadcastChannel === "undefined"
			? null
			: new BroadcastChannel("memorall-memon:changes");
	const listeners = new Set<(message: MemonChangeEnvelope) => void>();
	const handler = (event: MessageEvent<MemonChangeEnvelope>) => {
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
