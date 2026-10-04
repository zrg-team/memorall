import type {
	UsageBuckets,
	UsageFilters,
	UsageMetric,
	UsageRange,
	UsageRangeKey,
	UsageRequest,
	UsageSlice,
	UsageToolShare,
} from "../types";
import { BASE_FEATURE } from "./usage-features";

const dayStart = (date: Date) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, days: number) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const RANGE_DAYS: Record<Exclude<UsageRangeKey, "mtd">, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
};

/** The selected days up to today, and the same span right before them. */
export const resolveRange = (key: UsageRangeKey, now: Date): UsageRange => {
	const today = dayStart(now);
	const end = addDays(today, 1);
	if (key === "mtd") {
		const start = new Date(today.getFullYear(), today.getMonth(), 1);
		const days = today.getDate();
		const previousStart = new Date(
			today.getFullYear(),
			today.getMonth() - 1,
			1,
		);
		return {
			key,
			start: start.getTime(),
			end: end.getTime(),
			days,
			previousStart: previousStart.getTime(),
			previousEnd: addDays(previousStart, days).getTime(),
		};
	}
	const days = RANGE_DAYS[key];
	const start = addDays(end, -days);
	return {
		key,
		start: start.getTime(),
		end: end.getTime(),
		days,
		previousStart: addDays(start, -days).getTime(),
		previousEnd: start.getTime(),
	};
};

const bucketsFromEdges = (
	unit: UsageBuckets["unit"],
	edges: number[],
): UsageBuckets => {
	const count = edges.length - 1;
	const indexOf = (at: number) => {
		let low = 0;
		let high = count - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if ((edges[middle] ?? 0) <= at) low = middle;
			else high = middle - 1;
		}
		return low;
	};
	return { unit, edges, count, indexOf };
};

/** One bucket per day of the range. */
export const resolveDays = (range: UsageRange): UsageBuckets => {
	const start = new Date(range.start);
	const edges: number[] = [];
	for (let index = 0; index <= range.days; index++) {
		edges.push(addDays(start, index).getTime());
	}
	return bucketsFromEdges("day", edges);
};

/** Daily buckets up to a month; past that, weeks that end today. */
export const resolveBuckets = (range: UsageRange): UsageBuckets => {
	if (range.days <= 31) return resolveDays(range);
	const end = new Date(range.end);
	const count = Math.ceil(range.days / 7);
	const edges: number[] = [];
	for (let index = 0; index <= count; index++) {
		edges.push(
			Math.max(range.start, addDays(end, -(count - index) * 7).getTime()),
		);
	}
	return bucketsFromEdges("week", edges);
};

export const EMPTY_FILTERS: UsageFilters = {
	agent: null,
	provider: null,
	model: null,
	feature: null,
	tool: null,
};

/** Providers group as remote ids plus one bucket for everything on-device. */
export const LOCAL_PROVIDER_GROUP = "local";
export const providerGroupOf = (request: UsageRequest) =>
	request.local ? LOCAL_PROVIDER_GROUP : request.provider;

const shareMatches = (share: UsageToolShare, filters: UsageFilters) =>
	(!filters.tool || share.tool === filters.tool) &&
	(!filters.feature || share.feature === filters.feature);

/**
 * The requests inside the filters. Agent, provider and model select whole
 * requests; feature and tool select the part of each request their tool results
 * drove, so a filtered total is never more than the request cost.
 */
export const sliceRequests = (
	requests: readonly UsageRequest[],
	filters: UsageFilters,
	from: number,
	to: number,
): UsageSlice[] => {
	const slices: UsageSlice[] = [];
	for (const request of requests) {
		if (request.at < from || request.at >= to) continue;
		if (filters.agent !== null && request.agent !== filters.agent) continue;
		if (filters.provider && providerGroupOf(request) !== filters.provider) {
			continue;
		}
		if (filters.model && request.model !== filters.model) continue;
		if (!filters.feature && !filters.tool) {
			slices.push({ request, factor: 1, tools: request.tools });
			continue;
		}
		if (filters.feature === BASE_FEATURE && !filters.tool) {
			if (!request.tools.length) slices.push({ request, factor: 1, tools: [] });
			continue;
		}
		const tools = request.tools.filter((share) => shareMatches(share, filters));
		const factor = tools.reduce((sum, share) => sum + share.weight, 0);
		if (factor > 0) slices.push({ request, factor, tools });
	}
	return slices;
};

export const requestTokens = (request: UsageRequest) =>
	request.inputTokens + request.outputTokens;

export const requestValue = (request: UsageRequest, metric: UsageMetric) =>
	metric === "cost" ? (request.cost ?? 0) : requestTokens(request);

export const sliceValue = (slice: UsageSlice, metric: UsageMetric) =>
	requestValue(slice.request, metric) * slice.factor;

export const sumSlices = (
	slices: readonly UsageSlice[],
	value: (slice: UsageSlice) => number,
) => slices.reduce((sum, slice) => sum + value(slice), 0);

export const totalsBy = <K>(
	slices: readonly UsageSlice[],
	keyOf: (request: UsageRequest) => K,
	metric: UsageMetric,
): Map<K, number> => {
	const totals = new Map<K, number>();
	for (const slice of slices) {
		const key = keyOf(slice.request);
		totals.set(key, (totals.get(key) ?? 0) + sliceValue(slice, metric));
	}
	return totals;
};

export const seriesBy = <K>(
	slices: readonly UsageSlice[],
	keyOf: (request: UsageRequest) => K,
	value: (slice: UsageSlice) => number,
	buckets: UsageBuckets,
): Map<K, number[]> => {
	const series = new Map<K, number[]>();
	for (const slice of slices) {
		const key = keyOf(slice.request);
		let values = series.get(key);
		if (!values) {
			values = new Array<number>(buckets.count).fill(0);
			series.set(key, values);
		}
		const index = buckets.indexOf(slice.request.at);
		values[index] = (values[index] ?? 0) + value(slice);
	}
	return series;
};

export const totalSeries = (
	slices: readonly UsageSlice[],
	value: (slice: UsageSlice) => number,
	buckets: UsageBuckets,
): number[] =>
	seriesBy(slices, () => "total", value, buckets).get("total") ??
	new Array<number>(buckets.count).fill(0);

/** Each tool share as its own value, or the whole request as base chat. */
const forEachShare = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
	visit: (
		key: { feature: string; tool: string | null },
		value: number,
		slice: UsageSlice,
		share: UsageToolShare | null,
	) => void,
) => {
	for (const slice of slices) {
		const full = requestValue(slice.request, metric);
		if (!slice.request.tools.length) {
			visit(
				{ feature: BASE_FEATURE, tool: null },
				full * slice.factor,
				slice,
				null,
			);
			continue;
		}
		for (const share of slice.tools) {
			visit(
				{ feature: share.feature, tool: share.tool },
				full * share.weight,
				slice,
				share,
			);
		}
	}
};

/** Value per feature, and how many requests each feature took part in. */
export const featureTotals = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
) => {
	const totals = new Map<string, { value: number; requests: number }>();
	let current: UsageSlice | null = null;
	let seen = new Set<string>();
	forEachShare(slices, metric, (key, value, slice) => {
		if (slice !== current) {
			current = slice;
			seen = new Set();
		}
		const entry = totals.get(key.feature) ?? { value: 0, requests: 0 };
		entry.value += value;
		if (!seen.has(key.feature)) {
			entry.requests += 1;
			seen.add(key.feature);
		}
		totals.set(key.feature, entry);
	});
	return totals;
};

export const featureSeries = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
	buckets: UsageBuckets,
) => {
	const series = new Map<string, number[]>();
	forEachShare(slices, metric, (key, value, slice) => {
		let values = series.get(key.feature);
		if (!values) {
			values = new Array<number>(buckets.count).fill(0);
			series.set(key.feature, values);
		}
		const index = buckets.indexOf(slice.request.at);
		values[index] = (values[index] ?? 0) + value;
	});
	return series;
};

export interface ToolTotal {
	tool: string;
	feature: string;
	calls: number;
	resultChars: number;
	value: number;
}

export const toolTotals = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
): Map<string, ToolTotal> => {
	const totals = new Map<string, ToolTotal>();
	forEachShare(slices, metric, (key, value, _slice, share) => {
		if (!key.tool || !share) return;
		const entry = totals.get(key.tool) ?? {
			tool: key.tool,
			feature: key.feature,
			calls: 0,
			resultChars: 0,
			value: 0,
		};
		entry.calls += share.calls;
		entry.resultChars += share.resultChars;
		entry.value += value;
		totals.set(key.tool, entry);
	});
	return totals;
};

export const toolSeries = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
	buckets: UsageBuckets,
) => {
	const series = new Map<string, number[]>();
	forEachShare(slices, metric, (key, value, slice) => {
		if (!key.tool) return;
		let values = series.get(key.tool);
		if (!values) {
			values = new Array<number>(buckets.count).fill(0);
			series.set(key.tool, values);
		}
		const index = buckets.indexOf(slice.request.at);
		values[index] = (values[index] ?? 0) + value;
	});
	return series;
};

/**
 * How much of a row's cost is known. A provider that reports cost (OpenRouter)
 * prices its requests; on-device requests are free; any other remote request
 * has no price, so the row shows its tokens instead of a made-up $0.
 */
export interface CostCoverage {
	/** Some request reported a cost. */
	priced: boolean;
	/** Some request ran on a remote provider. */
	remote: boolean;
	/** Tokens of remote requests that reported no cost. */
	unpricedTokens: number;
}

/** A slice's part of each row it adds to: the key and its weight. */
export type RowWeights = (slice: UsageSlice) => ReadonlyArray<[string, number]>;

export const costCoverageBy = (
	slices: readonly UsageSlice[],
	weightsOf: RowWeights,
): Map<string, CostCoverage> => {
	const coverage = new Map<string, CostCoverage>();
	for (const slice of slices) {
		const { request } = slice;
		const unpriced = !request.local && request.cost === undefined;
		for (const [key, weight] of weightsOf(slice)) {
			const entry = coverage.get(key) ?? {
				priced: false,
				remote: false,
				unpricedTokens: 0,
			};
			entry.remote ||= !request.local;
			entry.priced ||= !request.local && request.cost !== undefined;
			if (unpriced) entry.unpricedTokens += requestTokens(request) * weight;
			coverage.set(key, entry);
		}
	}
	return coverage;
};

/** Whole requests, keyed by one of their fields. */
export const requestWeights =
	(keyOf: (request: UsageRequest) => string): RowWeights =>
	(slice) => [[keyOf(slice.request), slice.factor]];

/** Feature shares, the same split `featureTotals` uses. */
export const featureWeights: RowWeights = (slice) =>
	slice.request.tools.length
		? slice.tools.map((share) => [share.feature, share.weight])
		: [[BASE_FEATURE, slice.factor]];

/** Tool shares, the same split `toolTotals` uses. */
export const toolWeights: RowWeights = (slice) =>
	slice.tools.map((share) => [share.tool, share.weight]);

/** Relative change; null when there is nothing to compare with. */
export const changeOf = (current: number, previous: number): number | null =>
	previous > 0 ? (current - previous) / previous : null;

export interface TokenMix {
	input: number;
	cached: number;
	output: number;
	reasoning: number;
}

/** Fresh input, cached input, visible output and reasoning — they add up. */
export const tokenMix = (slices: readonly UsageSlice[]): TokenMix => {
	const mix: TokenMix = { input: 0, cached: 0, output: 0, reasoning: 0 };
	for (const { request, factor } of slices) {
		mix.input += (request.inputTokens - request.cachedTokens) * factor;
		mix.cached += request.cachedTokens * factor;
		mix.output += (request.outputTokens - request.reasoningTokens) * factor;
		mix.reasoning += request.reasoningTokens * factor;
	}
	return mix;
};

/** Weekday (Monday first) × hour of day, in local time. */
export const weekHourGrid = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
) => {
	const values = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
	const requests = Array.from({ length: 7 }, () =>
		new Array<number>(24).fill(0),
	);
	for (const slice of slices) {
		const date = new Date(slice.request.at);
		const day = (date.getDay() + 6) % 7;
		const hour = date.getHours();
		const valueRow = values[day];
		const requestRow = requests[day];
		if (!valueRow || !requestRow) continue;
		valueRow[hour] = (valueRow[hour] ?? 0) + sliceValue(slice, metric);
		requestRow[hour] = (requestRow[hour] ?? 0) + 1;
	}
	return { values, requests };
};

export interface ConversationTotal {
	conversationId: string;
	title: string;
	agent: string;
	model: string;
	models: number;
	requests: number;
	tokens: number;
	cost: number;
	value: number;
	lastAt: number;
}

export const conversationTotals = (
	slices: readonly UsageSlice[],
	metric: UsageMetric,
): ConversationTotal[] => {
	const totals = new Map<
		string,
		ConversationTotal & { modelTokens: Map<string, number> }
	>();
	for (const slice of slices) {
		const { request, factor } = slice;
		let entry = totals.get(request.conversationId);
		if (!entry) {
			entry = {
				conversationId: request.conversationId,
				title: request.conversationTitle,
				agent: request.agent,
				model: request.model,
				models: 0,
				requests: 0,
				tokens: 0,
				cost: 0,
				value: 0,
				lastAt: 0,
				modelTokens: new Map(),
			};
			totals.set(request.conversationId, entry);
		}
		const tokens = requestTokens(request) * factor;
		entry.requests += 1;
		entry.tokens += tokens;
		entry.cost += (request.cost ?? 0) * factor;
		entry.value += sliceValue(slice, metric);
		if (request.at >= entry.lastAt) {
			entry.lastAt = request.at;
			if (request.agent) entry.agent = request.agent;
		}
		entry.modelTokens.set(
			request.model,
			(entry.modelTokens.get(request.model) ?? 0) + tokens,
		);
	}
	return [...totals.values()].map(({ modelTokens, ...entry }) => {
		const ranked = [...modelTokens.entries()].sort((a, b) => b[1] - a[1]);
		return {
			...entry,
			model: ranked[0]?.[0] ?? entry.model,
			models: modelTokens.size,
		};
	});
};
