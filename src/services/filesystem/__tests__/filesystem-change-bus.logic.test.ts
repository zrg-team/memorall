import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeBroadcastChannel {
	static channels = new Map<string, Set<FakeBroadcastChannel>>();
	private readonly listeners = new Set<(event: MessageEvent) => void>();

	constructor(private readonly name: string) {
		let peers = FakeBroadcastChannel.channels.get(name);
		if (!peers) {
			peers = new Set();
			FakeBroadcastChannel.channels.set(name, peers);
		}
		peers.add(this);
	}

	addEventListener(_type: string, listener: (event: MessageEvent) => void) {
		this.listeners.add(listener);
	}

	removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
		this.listeners.delete(listener);
	}

	postMessage(data: unknown) {
		for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
			if (peer === this) continue;
			for (const listener of peer.listeners) {
				listener({ data } as MessageEvent);
			}
		}
	}

	close() {
		FakeBroadcastChannel.channels.get(this.name)?.delete(this);
	}
}

describe("BroadcastChannel filesystem change bus", () => {
	beforeEach(() => {
		FakeBroadcastChannel.channels.clear();
		vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
	});

	it("delivers cross-context changes and cleans up listeners", async () => {
		const { createFilesystemChangeBus } = await import(
			"../change-bus/broadcast-channel"
		);
		const publisher = createFilesystemChangeBus();
		const subscriber = createFilesystemChangeBus();
		const listener = vi.fn();
		const unsubscribe = subscriber.subscribe(listener);
		const message = {
			sourceContextId: "one",
			eventId: "event-one",
			change: { scope: "documents", operation: "write" },
		};

		publisher.publish(message);
		expect(listener).toHaveBeenCalledWith(message);
		unsubscribe();
		publisher.publish({ ...message, eventId: "event-two" });
		expect(listener).toHaveBeenCalledTimes(1);
		publisher.close();
		subscriber.close();
		vi.unstubAllGlobals();
	});
});
