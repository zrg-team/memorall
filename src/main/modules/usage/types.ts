/** The share of one model request that a tool result drove. */
export interface UsageToolShare {
	tool: string;
	/** Feature key from the flow catalog, or a fallback key (see usage-features). */
	feature: string;
	/** Fraction of the request (0–1); a request's shares add up to 1. */
	weight: number;
	/** Characters of the tool result the request read. */
	resultChars: number;
	/** 1 the first time a tool result is seen, so calls are counted once. */
	calls: number;
}

/** One model request — the unit every total on the page adds up. */
export interface UsageRequest {
	messageId: string;
	conversationId: string;
	conversationTitle: string;
	/** Epoch ms of the reply the request belongs to. */
	at: number;
	/** Agent display name; empty for the default chat. */
	agent: string;
	model: string;
	/** Provider id (`openai`, `wllama`, …); empty when the reply did not save it. */
	provider: string;
	local: boolean;
	/** USD, only when the provider reported it. */
	cost?: number;
	/** Prompt tokens, cached ones included. */
	inputTokens: number;
	cachedTokens: number;
	/** Completion tokens, reasoning included. */
	outputTokens: number;
	reasoningTokens: number;
	estimated: boolean;
	/** Tool results this request read; empty for a turn before any tool ran. */
	tools: UsageToolShare[];
}

/** A request, or the part of it a feature / tool filter selects. */
export interface UsageSlice {
	request: UsageRequest;
	/** Fraction of the request inside the filter (1 when unfiltered). */
	factor: number;
	/** The request's tool shares inside the filter. */
	tools: UsageToolShare[];
}

export type UsageMetric = "cost" | "tokens";

export type UsageRangeKey = "7d" | "30d" | "90d" | "mtd";

export interface UsageRange {
	key: UsageRangeKey;
	/** Local midnight of the first day, epoch ms. */
	start: number;
	/** Local midnight after the last day (exclusive), epoch ms. */
	end: number;
	days: number;
	previousStart: number;
	previousEnd: number;
}

export interface UsageBuckets {
	unit: "day" | "week";
	/** Bucket boundaries: bucket i covers [edges[i], edges[i + 1]). */
	edges: number[];
	count: number;
	indexOf: (at: number) => number;
}

export interface UsageFilters {
	agent: string | null;
	provider: string | null;
	model: string | null;
	feature: string | null;
	tool: string | null;
}

export type UsageFilterKey = keyof UsageFilters;

/** Raw row the usage query returns, one per assistant reply with usage. */
export interface UsageMessageRow {
	id: string;
	conversationId: string;
	createdAt: unknown;
	conversationTitle: string | null;
	flowName: string | null;
	agentName: string | null;
	model: string | null;
	provider: string | null;
	usage: unknown;
	toolExecutions: unknown;
	parts: unknown;
	/**
	 * A ledger row (a model request outside a chat reply): what the whole
	 * request is charged to. An agent tool (memon_code for pi code's requests)
	 * resolves to its feature; anything else (a Studio page run, charged to
	 * its studio) to its source's feature.
	 */
	charge?: { tool: string; source: string };
}

export interface UsageFeatureEntry {
	key: string;
	label: string;
	tools: readonly string[];
}

export type UsageInsight =
	| { kind: "agentRise"; agent: string; change: number; delta: number }
	| {
			kind: "peakDay";
			day: number;
			value: number;
			ratio: number;
			conversationTitle: string;
			share: number;
	  }
	| { kind: "topTool"; tool: string; share: number; avgResultTokens: number }
	| { kind: "cacheHit"; ratio: number }
	| { kind: "local"; share: number };
