/**
 * What a chat has cost so far: every reply's usage, as the provider reported
 * it, added up. `cost` is absent when no reply carried a price (a local
 * model, or a provider that does not report one).
 */
export interface ConversationCost {
	cost?: number;
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	/** Model requests across all replies (a reply with tools makes several). */
	requests: number;
	/** Replies that reported usage. */
	replies: number;
}

/** A dollar amount as small as a chat's: $1.24, $0.092, $0.0057. */
export const formatUsd = (value: number): string =>
	value >= 1
		? `$${value.toFixed(2)}`
		: value >= 0.01
			? `$${value.toFixed(3)}`
			: value > 0
				? `$${value.toFixed(4)}`
				: "$0";

/** A token count at a glance: 640, 76k, 1.7M. */
export const formatTokenCount = (value: number): string =>
	value >= 1_000_000
		? `${(value / 1_000_000).toFixed(1)}M`
		: value >= 1_000
			? `${Math.round(value / 1_000)}k`
			: String(Math.round(value));

/** Share of the input read from the provider's cache, 0–100. */
export const cachedPercent = (cost: ConversationCost): number =>
	cost.inputTokens > 0
		? Math.round((cost.cachedTokens / cost.inputTokens) * 100)
		: 0;
