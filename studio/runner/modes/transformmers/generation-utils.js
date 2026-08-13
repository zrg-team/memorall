export function trimSequences(sequences, promptLength) {
	if (typeof sequences?.slice === "function") {
		return sequences.slice(null, [promptLength, null]);
	}
	return sequences;
}

export function decodeTrimmedSequences(tokenizer, sequences) {
	return tokenizer.batch_decode(sequences, {
		skip_special_tokens: true,
	})[0] || "";
}

export function isRecoverableWebGPUExecutionError(error) {
	const message = error instanceof Error ? error.message : String(error || "");
	const normalized = message.toLowerCase();

	return (
		normalized.includes("failed to execute 'mapasync' on 'gpubuffer'") ||
		normalized.includes("a valid external instance reference no longer exists") ||
		normalized.includes("failed to download data from buffer") ||
		normalized.includes("buffer_manager::download") ||
		normalized.includes("device lost")
	);
}
