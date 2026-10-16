import { afterEach, describe, expect, it, vi } from "vitest";
import { nextCaptureSlot } from "../capture-slot";

afterEach(() => {
	vi.useRealTimers();
});

describe("turns at capturing a tab", () => {
	it("spaces every capture out, so Chrome's quota is never exceeded", async () => {
		vi.useFakeTimers();
		const turns: number[] = [];
		const start = Date.now();
		// Three callers at once: a screenshot, a page segment, the co-agent.
		const all = [nextCaptureSlot(), nextCaptureSlot(), nextCaptureSlot()].map(
			(slot) => slot.then(() => turns.push(Date.now() - start)),
		);
		await vi.runAllTimersAsync();
		await Promise.all(all);

		expect(turns).toHaveLength(3);
		expect(turns[1]! - turns[0]!).toBeGreaterThanOrEqual(550);
		expect(turns[2]! - turns[1]!).toBeGreaterThanOrEqual(550);
	});
});
