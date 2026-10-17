import { describe, expect, it } from "vitest";
import { pickScreenshotTarget } from "./browseros-backend";

const page = (url: string, id = url) => ({
	type: "page",
	url,
	webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
});

describe("pickScreenshotTarget", () => {
	it("takes the one page showing the session's address", () => {
		const targets = [
			page("https://a.example/"),
			{ type: "service_worker", url: "https://b.example/sw.js" },
			page("https://b.example/"),
		];
		expect(pickScreenshotTarget(targets, "https://b.example/")).toBe(
			targets[2],
		);
	});

	it("never guesses between several pages", () => {
		// The session's page moved on: another tab must not stand in for it.
		const moved = [page("https://a.example/"), page("https://b.example/")];
		expect(pickScreenshotTarget(moved, "https://c.example/")).toBeNull();
		// Two tabs on the same address cannot be told apart.
		const twins = [
			page("https://a.example/", "1"),
			page("https://a.example/", "2"),
		];
		expect(pickScreenshotTarget(twins, "https://a.example/")).toBeNull();
	});

	it("takes the only page there is, wherever it went", () => {
		const targets = [
			page("https://a.example/next"),
			{ type: "page", url: "https://b.example/" },
		];
		expect(pickScreenshotTarget(targets, "https://a.example/")).toBe(
			targets[0],
		);
	});
});
