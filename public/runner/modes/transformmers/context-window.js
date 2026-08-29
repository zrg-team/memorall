import { planContextFromMemoryHint } from "../../utils/context-planner.js";

export function getPromptLength(input) {
	return input?.input_ids?.dims?.[1] || 0;
}

export function resolveMaxContextTokens(tokenizer, modelConfig) {
	const tokenizerMaxRaw =
		typeof tokenizer?.model_max_length === "number"
			? tokenizer.model_max_length
			: undefined;
	const tokenizerMax =
		typeof tokenizerMaxRaw === "number" &&
		Number.isFinite(tokenizerMaxRaw) &&
		tokenizerMaxRaw > 0 &&
		tokenizerMaxRaw <= 1_000_000
			? tokenizerMaxRaw
			: undefined;

	const modelMaxRaw =
		typeof modelConfig?.max_position_embeddings === "number"
			? modelConfig.max_position_embeddings
			: typeof modelConfig?.n_positions === "number"
				? modelConfig.n_positions
				: typeof modelConfig?.context_length === "number"
					? modelConfig.context_length
					: typeof modelConfig?.max_seq_len === "number"
						? modelConfig.max_seq_len
						: typeof modelConfig?.n_ctx === "number"
							? modelConfig.n_ctx
							: typeof modelConfig?.seq_length === "number"
								? modelConfig.seq_length
								: undefined;
	const modelMax =
		typeof modelMaxRaw === "number" &&
		Number.isFinite(modelMaxRaw) &&
		modelMaxRaw > 0 &&
		modelMaxRaw <= 1_000_000
			? modelMaxRaw
			: undefined;

	return tokenizerMax ?? modelMax;
}

/**
 * Transformers.js picks WebGPU or WASM per model, so the budget it is sized
 * against is whichever the catalogue recorded for it.
 *
 * Note this deliberately does not clamp to the model's trained context: callers
 * here combine it with the tokenizer's own maximum separately.
 */
export function resolveMemoryContextTokens(memoryHint) {
	return planContextFromMemoryHint(memoryHint, { trainedContext: 0 })
		?.contextTokens;
}
