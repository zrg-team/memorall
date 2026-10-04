import { describe, expect, it } from "vitest";
import type { UsageRequest } from "../../types";
import {
	changeOf,
	conversationTotals,
	costCoverageBy,
	EMPTY_FILTERS,
	featureTotals,
	featureWeights,
	requestWeights,
	resolveBuckets,
	resolveRange,
	sliceRequests,
	sumSlices,
	sliceValue,
	tokenMix,
	toolTotals,
	toolWeights,
	totalsBy,
} from "../usage-aggregate";
import { BASE_FEATURE } from "../usage-features";
import { findInsights } from "../usage-insights";
import {
	formatAxisValue,
	formatChange,
	formatTokens,
	formatUsd,
	niceTicks,
} from "../usage-format";

const NOW = new Date(2026, 9, 4, 15, 0);
const day = (offset: number, hour = 10) =>
	new Date(2026, 9, 4 + offset, hour).getTime();

const request = (overrides: Partial<UsageRequest>): UsageRequest => ({
	messageId: "m",
	conversationId: "c1",
	conversationTitle: "Chat",
	at: day(0),
	agent: "CoAgent",
	model: "gpt-5.6-terra",
	provider: "openai",
	local: false,
	cost: 1,
	inputTokens: 100,
	cachedTokens: 0,
	outputTokens: 10,
	reasoningTokens: 0,
	estimated: false,
	tools: [],
	...overrides,
});

const share = (tool: string, feature: string, weight: number) => ({
	tool,
	feature,
	weight,
	resultChars: 400,
	calls: 1,
});

describe("ranges", () => {
	it("covers the last n days and the n days before", () => {
		const range = resolveRange("7d", NOW);
		expect(range.days).toBe(7);
		expect(new Date(range.start)).toEqual(new Date(2026, 8, 28));
		expect(new Date(range.end)).toEqual(new Date(2026, 9, 5));
		expect(new Date(range.previousStart)).toEqual(new Date(2026, 8, 21));
		expect(range.previousEnd).toBe(range.start);
	});

	it("compares month to date with the same days last month", () => {
		const range = resolveRange("mtd", NOW);
		expect(range.days).toBe(4);
		expect(new Date(range.previousStart)).toEqual(new Date(2026, 8, 1));
		expect(new Date(range.previousEnd)).toEqual(new Date(2026, 8, 5));
	});

	it("buckets by day up to a month and by week past it", () => {
		const daily = resolveBuckets(resolveRange("30d", NOW));
		expect(daily).toMatchObject({ unit: "day", count: 30 });
		expect(daily.indexOf(day(0))).toBe(29);
		const weekly = resolveBuckets(resolveRange("90d", NOW));
		expect(weekly).toMatchObject({ unit: "week", count: 13 });
		expect(weekly.indexOf(day(0))).toBe(12);
		expect(weekly.indexOf(day(-89))).toBe(0);
	});
});

describe("slicing and totals", () => {
	const requests = [
		request({ tools: [] }),
		request({
			agent: "Research Scout",
			cost: 2,
			tools: [share("web_read", "web", 0.75), share("fs_read", "fs", 0.25)],
		}),
		request({ local: true, provider: "wllama", cost: 0, model: "qwen" }),
		request({ at: day(-30), cost: 9 }),
	];
	const range = resolveRange("7d", NOW);

	it("keeps whole requests unless a feature or tool filter splits them", () => {
		const all = sliceRequests(requests, EMPTY_FILTERS, range.start, range.end);
		expect(all).toHaveLength(3);
		expect(sumSlices(all, (slice) => sliceValue(slice, "cost"))).toBe(3);

		const web = sliceRequests(
			requests,
			{ ...EMPTY_FILTERS, feature: "web" },
			range.start,
			range.end,
		);
		expect(sumSlices(web, (slice) => sliceValue(slice, "cost"))).toBe(1.5);

		const base = sliceRequests(
			requests,
			{ ...EMPTY_FILTERS, feature: BASE_FEATURE },
			range.start,
			range.end,
		);
		expect(base).toHaveLength(2);

		const local = sliceRequests(
			requests,
			{ ...EMPTY_FILTERS, provider: "local" },
			range.start,
			range.end,
		);
		expect(local.map((slice) => slice.request.model)).toEqual(["qwen"]);
	});

	it("splits a request across its features and tools", () => {
		const all = sliceRequests(requests, EMPTY_FILTERS, range.start, range.end);
		const features = featureTotals(all, "cost");
		expect(features.get(BASE_FEATURE)).toEqual({ value: 1, requests: 2 });
		expect(features.get("web")).toEqual({ value: 1.5, requests: 1 });
		expect(features.get("fs")?.value).toBe(0.5);
		const tools = toolTotals(all, "cost");
		expect(tools.get("web_read")).toMatchObject({ calls: 1, value: 1.5 });
		expect(totalsBy(all, (r) => r.agent, "tokens").get("CoAgent")).toBe(220);
	});

	it("adds up tokens by kind and conversations by value", () => {
		const all = sliceRequests(
			[
				request({
					inputTokens: 100,
					cachedTokens: 60,
					outputTokens: 20,
					reasoningTokens: 5,
				}),
			],
			EMPTY_FILTERS,
			range.start,
			range.end,
		);
		expect(tokenMix(all)).toEqual({
			input: 40,
			cached: 60,
			output: 15,
			reasoning: 5,
		});
		const [conversation] = conversationTotals(all, "cost");
		expect(conversation).toMatchObject({
			requests: 1,
			tokens: 120,
			cost: 1,
		});
	});

	it("keeps the tokens of requests that came back without a price", () => {
		const slices = sliceRequests(
			[
				request({ agent: "Paid", cost: 1 }),
				request({ agent: "Mixed", cost: 1 }),
				request({ agent: "Mixed", cost: undefined, inputTokens: 400 }),
				request({ agent: "Direct", cost: undefined }),
				request({ agent: "Local", local: true, provider: "wllama", cost: 0 }),
				request({
					agent: "Tools",
					cost: undefined,
					tools: [share("web_read", "web", 0.75), share("fs_read", "fs", 0.25)],
				}),
			],
			EMPTY_FILTERS,
			range.start,
			range.end,
		);
		const agents = costCoverageBy(
			slices,
			requestWeights((r) => r.agent),
		);
		expect(agents.get("Paid")).toEqual({
			priced: true,
			remote: true,
			unpricedTokens: 0,
		});
		expect(agents.get("Mixed")).toEqual({
			priced: true,
			remote: true,
			unpricedTokens: 410,
		});
		expect(agents.get("Direct")).toMatchObject({
			priced: false,
			unpricedTokens: 110,
		});
		expect(agents.get("Local")).toMatchObject({ remote: false, priced: false });
		const tools = costCoverageBy(slices, toolWeights);
		expect(tools.get("web_read")?.unpricedTokens).toBe(82.5);
		expect(tools.get("fs_read")?.unpricedTokens).toBe(27.5);
		const features = costCoverageBy(slices, featureWeights);
		expect(features.get(BASE_FEATURE)?.unpricedTokens).toBe(520);
	});

	it("says which agent grew and how much caching covered", () => {
		const current = sliceRequests(
			[
				request({ agent: "Research Scout", cost: 3, cachedTokens: 50 }),
				request({ agent: "CoAgent", cost: 1 }),
			],
			EMPTY_FILTERS,
			range.start,
			range.end,
		);
		const previous = sliceRequests(
			[
				request({ at: day(-8), agent: "Research Scout", cost: 1 }),
				request({ at: day(-8), agent: "CoAgent", cost: 1 }),
			],
			EMPTY_FILTERS,
			range.previousStart,
			range.previousEnd,
		);
		const insights = findInsights(
			current,
			previous,
			range,
			"cost",
			EMPTY_FILTERS,
		);
		expect(insights[0]).toEqual({
			kind: "agentRise",
			agent: "Research Scout",
			change: 2,
			delta: 2,
		});
		expect(insights).toContainEqual({ kind: "cacheHit", ratio: 0.25 });
	});
});

describe("formatting", () => {
	it("formats money, tokens and change", () => {
		expect(formatUsd(0)).toBe("$0.00");
		expect(formatUsd(0.004)).toBe("<$0.01");
		expect(formatUsd(12.345)).toBe("$12.35");
		expect(formatTokens(1_250_000)).toBe("1.3M");
		expect(formatTokens(12_000)).toBe("12K");
		expect(formatChange(0.051)).toBe("▲ 5.1%");
		expect(formatChange(-0.5)).toBe("▼ 50%");
		expect(changeOf(1, 0)).toBeNull();
	});

	it("picks round axis ticks", () => {
		expect(niceTicks(2.02)).toEqual({ ticks: [0, 1, 2, 3], top: 3, step: 1 });
		expect(niceTicks(0.36).step).toBe(0.1);
		expect(formatAxisValue(0.5, 0.5, "cost")).toBe("$0.50");
		expect(formatAxisValue(1_500_000, 500_000, "tokens")).toBe("1.5M");
	});
});
