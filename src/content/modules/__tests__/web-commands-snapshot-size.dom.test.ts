import { describe, expect, it } from "vitest";
import { WEB_CONTENT_COMMAND_SOURCE } from "@/services/web-browser/web-browser-protocol";
import { handleWebContentCommand } from "../web-commands";

const snapshotOf = async (maxHtmlChars: number) => {
	const response = await handleWebContentCommand({
		source: WEB_CONTENT_COMMAND_SOURCE,
		type: "web-tool:snapshot",
		maxHtmlChars,
	});
	if (!response.success || response.type !== "web-tool:snapshot-result") {
		throw new Error("Expected a successful snapshot.");
	}
	return response.snapshot;
};

describe("web snapshot size", () => {
	it("caps an unbounded request instead of letting the reply exceed Chrome's message limit", async () => {
		// Chrome drops any extension message over 64 MiB and the sender only sees
		// the port close, which the background reports as a missing content
		// script. The background asks for MAX_SAFE_INTEGER to mean "everything".
		document.body.innerHTML = `<p>${"x".repeat(200_000)}</p>`;

		const snapshot = await snapshotOf(Number.MAX_SAFE_INTEGER);

		expect(snapshot.html.length).toBeLessThan(32 * 1024 * 1024);
		expect(snapshot.text.length).toBeLessThan(32 * 1024 * 1024);
	});

	it("honours a smaller explicit limit and says it truncated", async () => {
		document.body.innerHTML = `<p>${"y".repeat(50_000)}</p>`;

		const snapshot = await snapshotOf(1_000);

		expect(snapshot.html).toContain("truncated by Memorall");
		expect(snapshot.text).toContain("truncated by Memorall");
		expect(snapshot.text.startsWith("y".repeat(1_000))).toBe(true);
	});

	it("leaves a page that fits well under the limit untouched", async () => {
		document.body.innerHTML = "<p>a small page</p>";

		const snapshot = await snapshotOf(Number.MAX_SAFE_INTEGER);

		expect(snapshot.html).not.toContain("truncated by Memorall");
		expect(snapshot.text).toBe("a small page");
	});
});
