import type { ModelCategory } from "../interfaces/model-category";

/**
 * Best-effort category for a hosted model that publishes nothing but its id.
 *
 * Matches generic capability words only - never product or vendor names - so
 * it keeps working as providers ship new models. Anything it cannot place is
 * treated as chat, and media pickers still offer those models (see
 * `toSelectable`), so a miss costs a scroll, not a missing model.
 */
const RULES: { pattern: RegExp; categories: ModelCategory[] }[] = [
	{ pattern: /(^|[-_/:.])(moderation|realtime)([-_/:.]|$)/i, categories: [] },
	{
		pattern: /(^|[-_/:.])(tts|speech)([-_/:.]|$)/i,
		categories: ["text-to-speech"],
	},
	{
		pattern: /(^|[-_/:.])(transcribe|transcription|asr|stt)([-_/:.]|$)/i,
		categories: ["speech-to-text"],
	},
	{ pattern: /(^|[-_/:.])image([-_/:.]|$)/i, categories: ["image-generation"] },
	{
		pattern: /(^|[-_/:.])(embed|embedding|embeddings)([-_/:.]|$)/i,
		categories: ["embedding"],
	},
	{
		pattern: /(^|[-_/:.])(music|audio-gen)([-_/:.]|$)/i,
		categories: ["text-to-audio"],
	},
];

export function classifyRemoteModel(modelId: string): ModelCategory[] {
	for (const rule of RULES) {
		if (rule.pattern.test(modelId)) {
			return rule.categories;
		}
	}
	return ["chat"];
}

/**
 * Providers that publish modalities (OpenRouter's `architecture`) are
 * classified from them instead of the id.
 */
export function classifyByModalities(modalities: {
	input?: readonly string[];
	output?: readonly string[];
}): ModelCategory[] | null {
	const output = modalities.output ?? [];
	if (output.length === 0) {
		return null;
	}
	const categories: ModelCategory[] = [];
	if (output.includes("text")) categories.push("chat");
	if (output.includes("image")) categories.push("image-generation");
	if (output.includes("audio") && !output.includes("text")) {
		categories.push("text-to-speech");
	}
	return categories.length > 0 ? categories : null;
}
