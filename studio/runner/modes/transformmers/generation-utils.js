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

/**
 * Reported to the host when the runner's WebGPU context is beyond repair.
 *
 * Kept in sync with `WEBGPU_CONTEXT_LOST_CODE` in
 * `src/services/llm/utils/webgpu-runner-errors.ts`.
 */
export const WEBGPU_CONTEXT_LOST_CODE = "TRANSFORMER_WEBGPU_CONTEXT_LOST";

/**
 * True when the failure killed the document's WebGPU device rather than just
 * this run. Nothing inside the iframe can undo that - the ONNX runtime keeps
 * the dead device for the life of the document, so every later session hits
 * the same wall. Recovery means a fresh runner document; see
 * `TransformerLLM.recoverFromContextLoss`.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
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
