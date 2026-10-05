import { describe, expect, it, vi } from "vitest";
import type { WebSessionEventMessage } from "@/services/web-browser/web-browser-protocol";
import {
	AGENT_NAVIGATION_GRACE_MS,
	createWebSessionEvents,
} from "../web-session-events";

const SESSION_TAB = 7;

const setup = () => {
	let clock = 1_000;
	const sent: WebSessionEventMessage[] = [];
	const forgetSession = vi.fn(async () => undefined);
	const events = createWebSessionEvents({
		sessionIdForTab: async (tabId) => (tabId === SESSION_TAB ? "s1" : null),
		forgetSession,
		send: (message) => sent.push(message),
		now: () => clock,
	});
	const advance = (ms: number) => {
		clock += ms;
	};
	// Lets the async session lookup finish.
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
	return { events, sent, forgetSession, advance, settle };
};

const committed = (
	url: string,
	extra: Partial<{
		tabId: number;
		frameId: number;
		transitionType: string;
	}> = {},
) => ({
	tabId: SESSION_TAB,
	frameId: 0,
	url,
	transitionType: "link",
	...extra,
});

describe("web session events", () => {
	it("reports the user's navigations, reloads and route changes in a session's tab", async () => {
		const { events, sent, settle } = setup();

		events.onCommitted(committed("https://shop.test/cart"));
		events.onCommitted(
			committed("https://shop.test/cart", { transitionType: "reload" }),
		);
		events.onHistoryStateUpdated(committed("https://shop.test/cart/2"));
		await settle();

		expect(sent.map((message) => message.event)).toEqual([
			{ kind: "navigated", url: "https://shop.test/cart", reload: false },
			{ kind: "navigated", url: "https://shop.test/cart", reload: true },
			{ kind: "navigated", url: "https://shop.test/cart/2", reload: false },
		]);
		expect(sent.every((message) => message.sessionId === "s1")).toBe(true);
	});

	it("ignores other tabs and frames inside the page", async () => {
		const { events, sent, settle } = setup();

		events.onCommitted(committed("https://other.test/", { tabId: 99 }));
		events.onCommitted(committed("https://ads.test/", { frameId: 3 }));
		await settle();

		expect(sent).toEqual([]);
	});

	it("leaves out what the tab does while the agent drives it, and just after", async () => {
		const { events, sent, settle, advance } = setup();

		await events.whileAgentDrives(
			SESSION_TAB,
			AGENT_NAVIGATION_GRACE_MS,
			async () => {
				events.onCommitted(committed("https://shop.test/by-agent"));
			},
		);
		// A redirect that follows the agent's navigation.
		events.onCommitted(committed("https://shop.test/redirected"));
		advance(AGENT_NAVIGATION_GRACE_MS + 1);
		events.onCommitted(committed("https://shop.test/by-user"));
		await settle();

		expect(sent.map((message) => message.event)).toEqual([
			{ kind: "navigated", url: "https://shop.test/by-user", reload: false },
		]);
	});

	it("still covers a tab while another of the agent's commands on it runs", async () => {
		const { events, sent, settle, advance } = setup();
		let finishLong: () => void = () => undefined;
		const long = events.whileAgentDrives(
			SESSION_TAB,
			0,
			() => new Promise<void>((resolve) => (finishLong = resolve)),
		);
		await events.whileAgentDrives(SESSION_TAB, 0, async () => undefined);
		advance(10);

		events.onCommitted(committed("https://shop.test/mid-command"));
		finishLong();
		await long;
		await settle();

		expect(sent).toEqual([]);
	});

	it("passes on the page's clicks and form submissions", async () => {
		const { events, sent, settle } = setup();

		events.onPageAction(SESSION_TAB, {
			kind: "clicked",
			target: 'link "Pricing"',
			href: "https://shop.test/pricing",
		});
		events.onPageAction(99, { kind: "submitted", target: 'form "Search"' });
		await settle();

		expect(sent).toEqual([
			{
				source: "memorall:web-session-event",
				sessionId: "s1",
				event: {
					kind: "clicked",
					target: 'link "Pricing"',
					href: "https://shop.test/pricing",
				},
			},
		]);
	});

	it("reports a tab the user closed, and forgets its session either way", async () => {
		const { events, sent, settle, forgetSession } = setup();

		events.onTabRemoved(SESSION_TAB);
		await settle();
		expect(sent.map((message) => message.event)).toEqual([{ kind: "closed" }]);
		expect(forgetSession).toHaveBeenCalledWith("s1");

		sent.length = 0;
		await events.whileAgentDrives(SESSION_TAB, 1_000, async () => {
			events.onTabRemoved(SESSION_TAB);
		});
		await settle();
		// The agent closed it: nothing to tell.
		expect(sent).toEqual([]);
		expect(forgetSession).toHaveBeenCalledTimes(2);
	});
});
