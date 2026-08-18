import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobNotificationMessage } from "@/services/background-jobs/bridges/types";
import {
	getContentJobConsumerCount,
	isRelayableContentSender,
	registerContentJobConsumer,
	relayJobNotificationToContent,
	unregisterContentJobConsumer,
} from "../messaging/relay";

const sendMessage = vi.fn(
	async (_tabId: number, _message: unknown) => undefined,
);

vi.stubGlobal("chrome", { tabs: { sendMessage } });

const progress = (): JobNotificationMessage => ({
	type: "JOB_PROGRESS",
	target: "all",
	sender: "offscreen",
	timestamp: 0,
	jobId: "job-1",
	progress: {
		stage: "Receiving response...",
		progress: 50,
		status: "processing",
	},
});

describe("content job relay eligibility", () => {
	it("rejects an extension page opened in a tab", () => {
		// The options page has a sender.tab.id like any tab, but
		// chrome.runtime.sendMessage already delivered to it. Relaying as well
		// would append every streamed fragment twice.
		expect(
			isRelayableContentSender(
				{ sender: "popup" },
				{ tab: { id: 7 }, url: "chrome-extension://abc/options.html" },
			),
		).toBe(false);
	});

	it("rejects a sender that claims to be content from an extension URL", () => {
		expect(
			isRelayableContentSender(
				{ sender: "content" },
				{ tab: { id: 7 }, url: "chrome-extension://abc/sandbox.html" },
			),
		).toBe(false);
	});

	it("rejects the offscreen document, which has no tab at all", () => {
		expect(isRelayableContentSender({ sender: "offscreen" }, {})).toBe(false);
	});

	it("accepts a content script injected in a page", () => {
		expect(
			isRelayableContentSender(
				{ sender: "content" },
				{ tab: { id: 7 }, url: "https://example.com/page" },
			),
		).toBe(true);
	});
});

describe("content job relay delivery", () => {
	beforeEach(() => {
		sendMessage.mockClear();
		for (let id = 0; id < 20; id += 1) unregisterContentJobConsumer(id);
	});

	it("costs nothing when no content script is listening", async () => {
		expect(getContentJobConsumerCount()).toBe(0);
		await relayJobNotificationToContent(progress(), undefined);
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("delivers a broadcast to each registered tab exactly once", async () => {
		registerContentJobConsumer(3);
		registerContentJobConsumer(3);
		registerContentJobConsumer(4);

		await relayJobNotificationToContent(progress(), undefined);

		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(sendMessage.mock.calls.map((call) => call[0])).toEqual([3, 4]);
	});

	it("stops delivering to a tab that has gone away", async () => {
		registerContentJobConsumer(3);
		unregisterContentJobConsumer(3);

		await relayJobNotificationToContent(progress(), undefined);

		expect(sendMessage).not.toHaveBeenCalled();
	});
});
