import type { AggregatedTokenUsage } from "@/services/llm/utils/token-usage";

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
	/**
	 * Of the totals above, what the chat's tools spent on models for it
	 * outside the replies (pi code working on the agent's task).
	 */
	tools?: { cost?: number; requests: number };
}

/** What a reply still running has used so far, summed over its requests. */
export type RunUsage = Omit<AggregatedTokenUsage, "calls">;

/**
 * A chat's cost with a running reply's usage on top. The saved total only has
 * a reply once it is finished, so a long agent turn would show the old total
 * until the end; this is what it has spent by now.
 */
export const withRunUsage = (
	cost: ConversationCost | undefined,
	usage: RunUsage | undefined,
): ConversationCost | undefined => {
	if (!usage) return cost;
	const base = cost ?? {
		inputTokens: 0,
		cachedTokens: 0,
		outputTokens: 0,
		requests: 0,
		replies: 0,
	};
	const priced = base.cost !== undefined || usage.cost !== undefined;
	return {
		...(priced ? { cost: (base.cost ?? 0) + (usage.cost ?? 0) } : {}),
		inputTokens: base.inputTokens + usage.prompt_tokens,
		cachedTokens: base.cachedTokens + (usage.cached_tokens ?? 0),
		outputTokens: base.outputTokens + usage.completion_tokens,
		requests: base.requests + usage.requests,
		replies: base.replies + 1,
		...(base.tools ? { tools: base.tools } : {}),
	};
};

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
