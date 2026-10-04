/** What a hosted model costs, in USD per million tokens. */
export interface ModelPricing {
	inputPerMillion: number;
	outputPerMillion: number;
	/** Input read from the provider's prompt cache, when priced apart. */
	cachedInputPerMillion?: number;
}

const TOKENS_PER_MILLION = 1_000_000;

/** A price per token as a listing gives it ("0.000002"), or nothing usable. */
const perTokenPrice = (value: unknown): number | undefined => {
	const parsed = typeof value === "string" ? Number(value) : value;
	// A negative price means "varies" (a router that picks the model per request).
	return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
		? parsed
		: undefined;
};

/** Per-token prices as per-million, without float noise (0.15, not 0.15000000000000002). */
const perMillion = (price: number): number =>
	Number((price * TOKENS_PER_MILLION).toPrecision(6));

/**
 * A model's price from an OpenAI-compatible `/models` entry that publishes
 * one: `pricing.prompt` and `pricing.completion`, in USD per token, as
 * OpenRouter lists them. Nothing when either is missing or varies.
 */
export const readModelPricing = (entry: unknown): ModelPricing | undefined => {
	const pricing =
		entry && typeof entry === "object"
			? (entry as { pricing?: unknown }).pricing
			: undefined;
	if (!pricing || typeof pricing !== "object") return undefined;
	const fields = pricing as Record<string, unknown>;
	const input = perTokenPrice(fields.prompt);
	const output = perTokenPrice(fields.completion);
	if (input === undefined || output === undefined) return undefined;
	const cached = perTokenPrice(fields.input_cache_read);
	return {
		inputPerMillion: perMillion(input),
		outputPerMillion: perMillion(output),
		...(cached !== undefined && cached !== input
			? { cachedInputPerMillion: perMillion(cached) }
			: {}),
	};
};

export const isFreeModel = (pricing: ModelPricing): boolean =>
	pricing.inputPerMillion === 0 && pricing.outputPerMillion === 0;

/** A per-million price for a label: "$0.15", "$3", "$0.075". */
export const formatPerMillion = (price: number): string =>
	`$${Number(price.toPrecision(3))}`;
