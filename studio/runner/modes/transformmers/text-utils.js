import { GEMMA_THINK_END, GEMMA_THINK_START } from "./constants.js";

export function cleanGemmaOutput(raw) {
	return raw
		.replace(/<\|?channel\|?>?\s*thought\s*/gi, GEMMA_THINK_START)
		.replace(/<\|?channell?\|?>/gi, GEMMA_THINK_END)
		.replace(/<\|?[a-z_]+\|?>/gi, "")
		.trim();
}

export function postprocessGeneratedText(text, bundle) {
	if (bundle?.postprocess === "gemma_clean") {
		return cleanGemmaOutput(text);
	}

	return text;
}

export function roundTokenCount(value, step = 128) {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}

	return Math.max(step, Math.floor(value / step) * step);
}
