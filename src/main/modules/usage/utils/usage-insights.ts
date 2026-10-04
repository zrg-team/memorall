import type {
	UsageFilters,
	UsageInsight,
	UsageMetric,
	UsageRange,
	UsageSlice,
} from "../types";
import {
	changeOf,
	resolveDays,
	sliceValue,
	toolTotals,
	totalSeries,
	totalsBy,
} from "./usage-aggregate";
import { CHARS_PER_TOKEN } from "./usage-format";

const MIN_RISE = 0.1;
const PEAK_RATIO = 2.2;
const MAX_INSIGHTS = 4;

/** The few things worth saying about this slice, most specific first. */
export const findInsights = (
	current: readonly UsageSlice[],
	previous: readonly UsageSlice[],
	range: UsageRange,
	metric: UsageMetric,
	filters: UsageFilters,
): UsageInsight[] => {
	const insights: UsageInsight[] = [];

	if (filters.agent === null) {
		const now = totalsBy(current, (request) => request.agent, metric);
		const before = totalsBy(previous, (request) => request.agent, metric);
		let best: { agent: string; delta: number; change: number } | null = null;
		for (const [agent, value] of now) {
			const change = changeOf(value, before.get(agent) ?? 0);
			const delta = value - (before.get(agent) ?? 0);
			if (change === null || change < MIN_RISE) continue;
			if (!best || delta > best.delta) best = { agent, delta, change };
		}
		if (best) insights.push({ kind: "agentRise", ...best });
	}

	if (range.days >= 7) {
		const days = resolveDays(range);
		const daily = totalSeries(
			current,
			(slice) => sliceValue(slice, metric),
			days,
		);
		const total = daily.reduce((sum, value) => sum + value, 0);
		const average = total / daily.length;
		const peak = Math.max(...daily);
		const index = daily.indexOf(peak);
		const from = days.edges[index] ?? 0;
		const to = days.edges[index + 1] ?? 0;
		if (average > 0 && peak > average * PEAK_RATIO) {
			const onDay = current.filter(
				(slice) => slice.request.at >= from && slice.request.at < to,
			);
			const byConversation = totalsBy(
				onDay,
				(request) => request.conversationTitle,
				metric,
			);
			const [title, value] = [...byConversation.entries()].sort(
				(a, b) => b[1] - a[1],
			)[0] ?? ["", 0];
			insights.push({
				kind: "peakDay",
				day: from,
				value: peak,
				ratio: peak / average,
				conversationTitle: title,
				share: peak > 0 ? value / peak : 0,
			});
		}
	}

	if (filters.tool === null) {
		const tools = [...toolTotals(current, metric).values()];
		const total = tools.reduce((sum, tool) => sum + tool.value, 0);
		const top = [...tools].sort((a, b) => b.value - a.value)[0];
		if (top && total > 0 && top.calls > 0) {
			insights.push({
				kind: "topTool",
				tool: top.tool,
				share: top.value / total,
				avgResultTokens: top.resultChars / CHARS_PER_TOKEN / top.calls,
			});
		}
	}

	const remote = current.filter((slice) => !slice.request.local);
	const input = remote.reduce(
		(sum, slice) => sum + slice.request.inputTokens * slice.factor,
		0,
	);
	const cached = remote.reduce(
		(sum, slice) => sum + slice.request.cachedTokens * slice.factor,
		0,
	);
	if (input > 0 && cached / input >= 0.05) {
		insights.push({ kind: "cacheHit", ratio: cached / input });
	}

	const local = current.filter((slice) => slice.request.local).length;
	if (local > 0 && current.length > 0) {
		insights.push({ kind: "local", share: local / current.length });
	}

	return insights.slice(0, MAX_INSIGHTS);
};
