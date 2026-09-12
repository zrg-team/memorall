import { describe, expect, it } from "vitest";
import { describeCacheContinuity, type TokenUsage } from "../token-usage";

const call = (prompt_tokens: number, cached_tokens?: number): TokenUsage => ({
	prompt_tokens,
	completion_tokens: 0,
	total_tokens: prompt_tokens,
	...(cached_tokens === undefined ? {} : { cached_tokens }),
});

/**
 * A real 18-request agent turn on DeepSeek through OpenRouter.
 *
 * Its per-request percentages mostly look healthy — 84%, 88%, 98% — yet 168k
 * tokens were read cold, because the conversation was spread across four
 * upstream providers and each could only reuse the request it last served.
 * Worked out by hand, the requests that did not reuse the one before them were
 * #3, #4, #8, #9, #11, #13 and #14. The classifier has to reach the same
 * answer on its own.
 */
const realTurn = [
	[6107, 0],
	[6254, 6016],
	[24831, 0],
	[50714, 0],
	[54964, 50688],
	[60274, 54912],
	[63417, 60160],
	[66185, 24704],
	[71653, 63360],
	[73056, 71552],
	[78891, 66176],
	[82890, 78848],
	[86641, 0],
	[88859, 72960],
	[90849, 88832],
	[93587, 90752],
	[93784, 93568],
	[95317, 93696],
].map(([input, cached]) => call(input, cached));

describe("describeCacheContinuity", () => {
	it("finds exactly the requests that missed in a real fragmented turn", () => {
		const result = describeCacheContinuity(realTurn);
		const missed = result
			.map((status, index) => ({ status, request: index + 1 }))
			.filter(({ status }) => status === "partial" || status === "restarted")
			.map(({ request }) => request);

		expect(missed).toEqual([3, 4, 8, 9, 11, 13, 14]);
	});

	it("tells a partial read from a full restart", () => {
		const result = describeCacheContinuity(realTurn);

		// #8 read 24,704 of #7's 63,417: it reused an older request's prefix.
		expect(result[7]).toBe("partial");
		// #13 read nothing at all.
		expect(result[12]).toBe("restarted");
	});

	it("does not flag a turn that is caching properly", () => {
		// Each request reads the previous one minus a small tail.
		const healthy = [
			call(10_000, 0),
			call(12_000, 9_950),
			call(15_000, 11_936),
			call(18_000, 14_976),
		];

		expect(describeCacheContinuity(healthy)).toEqual([
			"first",
			"continued",
			"continued",
			"continued",
		]);
	});

	it("tolerates the normal tail and block rounding", () => {
		// 127 tokens short of the previous request is the reminder tail plus
		// DeepSeek rounding to 64-token blocks, not a miss.
		expect(
			describeCacheContinuity([call(24_831, 0), call(66_185, 24_704)]),
		).toEqual(["first", "continued"]);
	});

	it("flags a large loss even when the percentage still looks good", () => {
		// 66,176 of 78,891 is 84% — but the previous request was 73,056, so
		// almost 7k tokens that should have been reused were read cold.
		expect(
			describeCacheContinuity([call(73_056, 71_552), call(78_891, 66_176)]),
		).toEqual(["first", "partial"]);
	});

	it("says unknown rather than guessing when there is no cache data", () => {
		expect(describeCacheContinuity([call(1_000), call(2_000)])).toEqual([
			"first",
			"unknown",
		]);
	});

	it("never flags the first request", () => {
		expect(describeCacheContinuity([call(50_000, 0)])).toEqual(["first"]);
		expect(describeCacheContinuity([])).toEqual([]);
	});
});
