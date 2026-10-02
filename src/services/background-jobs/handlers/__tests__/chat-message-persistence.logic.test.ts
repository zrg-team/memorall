import { afterEach, describe, expect, it, vi } from "vitest";
import {
	compactParts,
	createReplyCheckpointer,
	persistReplyWithFallback,
	textFromParts,
} from "../chat-message-persistence";

const parts = [
	{ role: "assistant", content: "Let me read the page.", tool_calls: [] },
	{ role: "tool", content: "x".repeat(10_000), tool_call_id: "c1" },
	{ role: "assistant", content: "Here is the review." },
];
const metadata = {
	model: "m",
	toolExecutions: [{ id: "c1" }],
	actions: [{ id: "a" }],
};
const minimal = ({
	toolExecutions: _t,
	actions: _a,
	...rest
}: typeof metadata) => rest as typeof metadata;

describe("saving a reply the user has seen", () => {
	afterEach(() => vi.useRealTimers());

	it("keeps the full reply when it can", async () => {
		const write = vi.fn(async () => undefined);
		const result = await persistReplyWithFallback(
			{ content: "", parts, metadata },
			write,
			minimal,
		);
		expect(result).toEqual({ form: "full" });
		expect(write).toHaveBeenCalledTimes(1);
	});

	it("falls back to shorter tool outputs, then to the text alone", async () => {
		const tooBig = new Error("row too large");
		const writes: unknown[] = [];
		const write = vi.fn(async (reply: unknown) => {
			writes.push(reply);
			if (writes.length < 3)
				throw writes.length === 1 ? tooBig : new Error("again");
		});

		const result = await persistReplyWithFallback(
			{ content: "", parts, metadata },
			write,
			minimal,
		);

		expect(result).toEqual({ form: "text", fullError: tooBig });
		const compact = writes[1] as { parts: typeof parts };
		expect((compact.parts[1].content as string).length).toBeLessThan(5_000);
		expect(writes[2]).toEqual({
			content: "Let me read the page.\n\nHere is the review.",
			parts: null,
			metadata: { model: "m" },
		});
	});

	it("reports the failure when nothing could be kept", async () => {
		const first = new Error("database closed");
		let calls = 0;
		await expect(
			persistReplyWithFallback(
				{ content: "hi", parts: null, metadata },
				async () => {
					calls += 1;
					throw calls === 1 ? first : new Error("still closed");
				},
				minimal,
			),
		).rejects.toBe(first);
	});

	it("leaves parts it cannot read as they are", () => {
		expect(compactParts(null)).toBeNull();
		expect(textFromParts("not parts")).toBe("");
	});

	it("saves a running reply only when it changed, one write at a time", async () => {
		vi.useFakeTimers();
		let key = "a";
		let finishWrite: () => void = () => undefined;
		const save = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				}),
		);
		const checkpointer = createReplyCheckpointer({
			snapshot: () => ({ key, save }),
			intervalMs: 1_000,
		});
		checkpointer.start();

		await vi.advanceTimersByTimeAsync(1_000);
		expect(save).toHaveBeenCalledTimes(1);
		// Still writing: the next tick waits rather than piling up.
		key = "b";
		await vi.advanceTimersByTimeAsync(1_000);
		expect(save).toHaveBeenCalledTimes(1);
		finishWrite();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(save).toHaveBeenCalledTimes(2);
		finishWrite();
		// Nothing new: no write.
		await vi.advanceTimersByTimeAsync(3_000);
		expect(save).toHaveBeenCalledTimes(2);

		// Stopping waits for a write in flight, then nothing more is saved.
		key = "c";
		await vi.advanceTimersByTimeAsync(1_000);
		let stopped = false;
		const stopping = checkpointer.stop().then(() => {
			stopped = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(stopped).toBe(false);
		finishWrite();
		await stopping;
		key = "d";
		await vi.advanceTimersByTimeAsync(5_000);
		expect(save).toHaveBeenCalledTimes(3);
	});
});
