import { describe, expect, it } from "vitest";
import {
	findCoAgentPageChanges,
	formatCoAgentPageLabel,
	getCoAgentPage,
	isCoAgentMessage,
} from "../coagent-timeline";

const coAgent = (id: string, pageUrl: string, pageTitle = "A listing") => ({
	id,
	metadata: { source: "co-agent", pageUrl, pageTitle },
});

const typed = (id: string) => ({ id, metadata: {} });

const PAGE_A = "https://batdongsan.com.vn/ban-nha-mat-pho-1";
const PAGE_B = "https://batdongsan.com.vn/ban-nha-mat-pho-2";

describe("reading a page off a message", () => {
	it("reads the page a co-agent turn was asked on", () => {
		expect(getCoAgentPage(coAgent("m1", PAGE_A))).toEqual({
			url: PAGE_A,
			title: "A listing",
		});
	});

	it("ignores a turn typed in the panel", () => {
		expect(getCoAgentPage(typed("m1"))).toBeNull();
	});

	it("ignores a co-agent turn with no page recorded", () => {
		expect(
			getCoAgentPage({ id: "m1", metadata: { source: "co-agent" } }),
		).toBeNull();
	});

	it("survives metadata that is missing or the wrong shape", () => {
		expect(getCoAgentPage({ id: "m1" })).toBeNull();
		expect(getCoAgentPage({ id: "m1", metadata: null })).toBeNull();
		expect(getCoAgentPage({ id: "m1", metadata: "co-agent" })).toBeNull();
	});

	it("knows a co-agent turn even without a page", () => {
		expect(
			isCoAgentMessage({ id: "m1", metadata: { source: "co-agent" } }),
		).toBe(true);
		expect(isCoAgentMessage(typed("m1"))).toBe(false);
	});
});

describe("naming a page", () => {
	it("uses the host and the last path segment", () => {
		expect(formatCoAgentPageLabel({ url: PAGE_A, title: null })).toBe(
			"batdongsan.com.vn/ban-nha-mat-pho-1",
		);
	});

	it("falls back to the host when the path is long", () => {
		expect(
			formatCoAgentPageLabel({
				url: "https://example.com/a/very-long-slug-that-nobody-wants-to-read-in-a-chip",
				title: null,
			}),
		).toBe("example.com");
	});

	it("uses the bare host for a site root", () => {
		expect(
			formatCoAgentPageLabel({ url: "https://example.com/", title: null }),
		).toBe("example.com");
	});

	it("falls back to the title when the url cannot be parsed", () => {
		expect(
			formatCoAgentPageLabel({ url: "not a url", title: "Some page" }),
		).toBe("Some page");
	});
});

describe("tracing the route through a session", () => {
	it("announces the page a run starts on", () => {
		const changes = findCoAgentPageChanges([coAgent("m1", PAGE_A)]);
		expect([...changes.keys()]).toEqual(["m1"]);
	});

	it("stays quiet while the session stays on one page", () => {
		const changes = findCoAgentPageChanges([
			coAgent("m1", PAGE_A),
			coAgent("m2", PAGE_A),
			coAgent("m3", PAGE_A),
		]);
		// One marker for the whole stretch, not one per turn.
		expect([...changes.keys()]).toEqual(["m1"]);
	});

	it("marks the move when the session follows a link", () => {
		const changes = findCoAgentPageChanges([
			coAgent("m1", PAGE_A),
			coAgent("m2", PAGE_A),
			coAgent("m3", PAGE_B),
			coAgent("m4", PAGE_B),
		]);

		expect([...changes.keys()]).toEqual(["m1", "m3"]);
		expect(changes.get("m3")?.url).toBe(PAGE_B);
	});

	it("marks a return to a page visited earlier", () => {
		const changes = findCoAgentPageChanges([
			coAgent("m1", PAGE_A),
			coAgent("m2", PAGE_B),
			coAgent("m3", PAGE_A),
		]);
		// Going back is a move too; the reader needs to see it happen.
		expect([...changes.keys()]).toEqual(["m1", "m2", "m3"]);
	});

	it("re-announces the page after a turn typed in the panel", () => {
		const changes = findCoAgentPageChanges([
			coAgent("m1", PAGE_A),
			typed("m2"),
			coAgent("m3", PAGE_A),
		]);
		// The run was interrupted, so the next co-agent turn says where it is
		// rather than appearing to continue the earlier one.
		expect([...changes.keys()]).toEqual(["m1", "m3"]);
	});

	it("has nothing to say about a conversation with no co-agent turns", () => {
		expect(findCoAgentPageChanges([typed("m1"), typed("m2")]).size).toBe(0);
	});
});
