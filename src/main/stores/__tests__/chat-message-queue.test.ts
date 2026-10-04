import { beforeEach, describe, expect, it } from "vitest";
import {
	type QueuedChatMessage,
	useChatMessageQueueStore,
} from "../chat-message-queue";

const message = (id: string): QueuedChatMessage => ({
	id,
	text: `message ${id}`,
	images: [],
	documentRefs: [],
	agentFlowId: null,
	concurrent: true,
	createdAt: 0,
});

const store = () => useChatMessageQueueStore.getState();

describe("chat message queue", () => {
	beforeEach(() => {
		useChatMessageQueueStore.setState(
			useChatMessageQueueStore.getInitialState(),
			true,
		);
	});

	it("sends queued messages oldest first, per chat", () => {
		store().enqueue("chat-a", message("1"));
		store().enqueue("chat-a", [message("2"), message("3")]);
		store().enqueue("chat-b", message("b1"));

		expect(store().dequeue("chat-a")?.id).toBe("1");
		expect(store().remove("chat-a", "3")?.id).toBe("3");
		expect(store().queued["chat-a"]?.map((item) => item.id)).toEqual(["2"]);
		expect(store().dequeue("chat-a")?.id).toBe("2");
		// An emptied chat leaves no entry behind.
		expect(store().queued).toEqual({ "chat-b": [message("b1")] });
		expect(store().dequeue("chat-a")).toBeUndefined();
	});

	it("puts what the run did not read back at the front", () => {
		store().enqueue("chat-a", message("later"));
		store().addPending("chat-a", message("p1"));
		store().addPending("chat-a", message("p2"));
		// The agent read one of them.
		expect(store().removePending("chat-a", "p1")?.id).toBe("p1");

		store().enqueue("chat-a", store().takePending("chat-a"), "front");

		expect(store().pending).toEqual({});
		expect(store().queued["chat-a"]?.map((item) => item.id)).toEqual([
			"p2",
			"later",
		]);
	});

	it("pauses a chat's queue until the user lets it go on", () => {
		store().setPaused("chat-a", true);
		expect(store().paused).toEqual({ "chat-a": true });
		store().setPaused("chat-a", false);
		expect(store().paused).toEqual({});
	});
});
