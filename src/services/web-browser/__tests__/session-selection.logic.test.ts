import { describe, expect, it } from "vitest";
import {
	pickLatestTabSession,
	pickTabSessionForUrl,
	type TabSessionCandidate,
} from "../session-selection";

const session = (over: Partial<TabSessionCandidate>): TabSessionCandidate => ({
	id: "s",
	tabId: 1,
	mode: "tab",
	currentUrl: "https://example.com/",
	lastAccessedAt: 0,
	...over,
});

describe("pickTabSessionForUrl", () => {
	it("uses a tab already on that site, not merely the newest one", () => {
		// A Google search tab sends Google's cookies, which trips exactly the
		// hotlink check that fetching through a tab was meant to satisfy.
		const sessions = [
			session({
				id: "google",
				currentUrl: "https://www.google.com/search",
				lastAccessedAt: 99,
			}),
			session({
				id: "listing",
				currentUrl: "https://batdongsan.com.vn/a-listing",
				lastAccessedAt: 1,
			}),
		];

		expect(
			pickTabSessionForUrl(sessions, "https://batdongsan.com.vn/photo.jpg")?.id,
		).toBe("listing");
	});

	it("takes the most recent tab on that site when several match", () => {
		const sessions = [
			session({
				id: "old",
				currentUrl: "https://batdongsan.com.vn/one",
				lastAccessedAt: 1,
			}),
			session({
				id: "new",
				currentUrl: "https://batdongsan.com.vn/two",
				lastAccessedAt: 5,
			}),
		];

		expect(
			pickTabSessionForUrl(sessions, "https://batdongsan.com.vn/photo.jpg")?.id,
		).toBe("new");
	});

	it("falls back to the newest tab when nothing is on that site", () => {
		const sessions = [
			session({ id: "a", lastAccessedAt: 1 }),
			session({ id: "b", lastAccessedAt: 9 }),
		];

		expect(pickTabSessionForUrl(sessions, "https://other.test/x.jpg")?.id).toBe(
			"b",
		);
	});

	it("ignores iframe sessions, which cannot fetch at all", () => {
		const sessions = [
			session({
				id: "iframe",
				mode: "iframe",
				currentUrl: "https://batdongsan.com.vn/a",
				lastAccessedAt: 99,
			}),
			session({ id: "tab", lastAccessedAt: 1 }),
		];

		expect(
			pickTabSessionForUrl(sessions, "https://batdongsan.com.vn/photo.jpg")?.id,
		).toBe("tab");
	});

	it("ignores a session with no tab behind it", () => {
		expect(
			pickTabSessionForUrl(
				[session({ id: "x", tabId: undefined })],
				"https://a.test/i.png",
			),
		).toBeUndefined();
	});

	it("still answers for an unparseable url", () => {
		expect(pickTabSessionForUrl([session({ id: "a" })], "not a url")?.id).toBe(
			"a",
		);
	});

	it("has nothing to offer when no tab is open", () => {
		expect(pickTabSessionForUrl([], "https://a.test/i.png")).toBeUndefined();
	});
});

describe("pickLatestTabSession", () => {
	it("takes the most recently used usable tab", () => {
		const sessions = [
			session({ id: "a", lastAccessedAt: 3 }),
			session({ id: "b", lastAccessedAt: 7 }),
			session({ id: "iframe", mode: "iframe", lastAccessedAt: 9 }),
		];

		expect(pickLatestTabSession(sessions)?.id).toBe("b");
	});
});
