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

export function resolveMemoryContextTokens(memoryHint) {
	if (!memoryHint || typeof memoryHint !== "object") {
		return undefined;
	}

	const { availableGB, sizeGB, kvBytesPerToken } = memoryHint;
	const hasValidNumbers =
		typeof availableGB === "number" &&
		Number.isFinite(availableGB) &&
		availableGB > 0 &&
		typeof sizeGB === "number" &&
		Number.isFinite(sizeGB) &&
		sizeGB >= 0 &&
		typeof kvBytesPerToken === "number" &&
		Number.isFinite(kvBytesPerToken) &&
		kvBytesPerToken > 0;

	if (!hasValidNumbers) {
		return undefined;
	}

	const availableForKV = availableGB / 1.2 - sizeGB;
	if (availableForKV <= 0) {
		return 0;
	}

	const maxTokens = Math.floor((availableForKV * 1024 ** 3) / kvBytesPerToken);
	return Math.max(0, Math.floor(maxTokens / 1024) * 1024);
}
