import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebPageOutline } from "@/services/web-browser/web-browser-protocol";
import { settleOutline } from "../settle-outline";

const page = (
	text: string[],
	extra: Partial<WebPageOutline> = {},
): WebPageOutline => ({
	url: "https://app.example.com/",
	title: "App",
	docToken: "doc-1",
	blocks: text.map((line) => ({ kind: "text" as const, text: line })),
	omittedAbove: 0,
	omittedBelow: 0,
	scroll: { y: 0, viewportHeight: 800, pageHeight: 800 },
	...extra,
});

/** Reads that return each page in turn, then the last one forever. */
const reads = (...pages: WebPageOutline[]) => {
	let index = 0;
	return vi.fn(async () => pages[Math.min(index++, pages.length - 1)]);
};

describe("settleOutline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("reads a client-rendered page again until its content stops changing", async () => {
		const read = reads(
			page(["Loading…"]),
			page(["Loading…"]),
			page(["Inbox", "3 unread"]),
		);
		const settled = settleOutline(read, { timeoutMs: 10_000 });
		await vi.advanceTimersByTimeAsync(2_000);

		const outline = await settled;
		expect(outline.blocks).toEqual([
			{ kind: "text", text: "Inbox" },
			{ kind: "text", text: "3 unread" },
		]);
		expect(outline.busy).toBeUndefined();
	});

	it("returns a page that is already drawn after a short quiet spell", async () => {
		const read = reads(page(["Hello"]));
		let done = false;
		const settled = settleOutline(read, { timeoutMs: 10_000 }).then(
			(outline) => {
				done = true;
				return outline;
			},
		);
		await vi.advanceTimersByTimeAsync(600);
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(400);
		expect(done).toBe(true);
		expect((await settled).blocks).toEqual([{ kind: "text", text: "Hello" }]);
	});

	it("keeps waiting while the page says it is busy", async () => {
		const read = reads(
			page(["Results"], { busy: true }),
			page(["Results"], { busy: true }),
			page(["Results"], { busy: true }),
			page(["Results"], { busy: true }),
			page(["Results"], { busy: true }),
			page(["Results", "42 found"]),
		);
		const settled = settleOutline(read, { timeoutMs: 10_000 });
		await vi.advanceTimersByTimeAsync(3_000);

		const outline = await settled;
		expect(outline.blocks).toHaveLength(2);
		expect(outline.busy).toBeUndefined();
	});

	it("gives an empty shell longer to run its scripts", async () => {
		const read = reads(page([]));
		let done = false;
		const settled = settleOutline(read, { timeoutMs: 10_000 }).then(
			(outline) => {
				done = true;
				return outline;
			},
		);
		await vi.advanceTimersByTimeAsync(1_500);
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(done).toBe(true);
		expect((await settled).busy).toBeUndefined();
	});

	it("returns the last read marked busy when the page never holds still", async () => {
		let tick = 0;
		const read = vi.fn(async () => page([`Price ${++tick}`]));
		const settled = settleOutline(read, { timeoutMs: 2_000 });
		await vi.advanceTimersByTimeAsync(3_000);

		const outline = await settled;
		expect(outline.busy).toBe(true);
		expect(outline.blocks[0]).toEqual({
			kind: "text",
			text: `Price ${tick}`,
		});
	});

	it("reads again while the page is between documents", async () => {
		const read = vi
			.fn<() => Promise<WebPageOutline>>()
			.mockRejectedValueOnce(new Error("The page did not answer."))
			.mockResolvedValue(page(["Signed in"], { docToken: "doc-2" }));
		const settled = settleOutline(read, { timeoutMs: 10_000 });
		await vi.advanceTimersByTimeAsync(2_000);

		expect((await settled).docToken).toBe("doc-2");
	});

	it("fails with the page's error when it never answers", async () => {
		const read = vi.fn(async (): Promise<WebPageOutline> => {
			throw new Error("This embedded tab is closed.");
		});
		const settled = settleOutline(read, { timeoutMs: 1_000 });
		const failed = expect(settled).rejects.toThrow(
			"This embedded tab is closed.",
		);
		await vi.advanceTimersByTimeAsync(2_000);
		await failed;
	});
});
