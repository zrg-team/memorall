import type { ToolSupportMode } from "./tool-capability";

export type LLMProvider = "transformer" | "webllm" | "wllama";

/**
 * What a model can do, independent of how fast or how large it is.
 *
 * These mirror the signals the runners already detect at load time
 * (`public/runner/modes/transformmers/capabilities.js`), hoisted into the
 * catalog so the recommender can rank on them *before* a download. Because
 * they mirror runtime detection they are machine-verifiable — `yarn
 * audit:llm-models` re-derives them from the model's own Hub files.
 */
export interface ModelAbilities {
	/**
	 * "native" — the chat template declares tool_calls, so tools/tool_choice
	 * are passed straight through. "prompt_injection" — the tool adapter
	 * injects a JSON instruction block and parses the reply. "none" — the
	 * model cannot be trusted with tools at all.
	 */
	tools: ToolSupportMode;
	/** Accepts image input (mmproj projector, or a vision_config in config.json). */
	vision: boolean;
	/** Emits an explicit thinking phase before the answer. */
	reasoning: boolean;
	/** Trained for more than English. */
	multilingual: boolean;
}

/**
 * Published eval numbers backing `qualityScore`, so the ranking input stops
 * being an unsourced assertion.
 *
 * Every benchmark is optional because models publish different subsets;
 * `deriveQualityScore` ranks each model only against peers that reported the
 * same benchmark, so an absent entry is never a penalty.
 */
export interface ModelQualityEvidence {
	/** Reported scores, 0-100. Only include benchmarks the model actually published. */
	scores: Partial<
		Record<"mmlu" | "gpqa" | "ifeval" | "humaneval" | "bfcl", number>
	>;
	/** Model card, paper, or leaderboard URL the numbers came from. */
	source: string;
	/** YYYY-MM the evidence was recorded, so staleness is visible. */
	recordedAt: string;
}

export interface TransformerRunnerConfig {
	runtime:
		| "causal_lm"
		| "text_generation_pipeline"
		| "image_text_to_text"
		| "vision2seq"
		| "seq2seq_lm";
	dtype?: string;
	moduleDtype?: Record<string, string>;
	postprocess?: "none" | "gemma_clean";
	processorMode?: "chat_template_images";
	modelClassFallback?: "gemma4" | "florence2";
	webgpuMaxContextTokens?: number;
}

export interface WllamaModelConfig {
	filename: string;
	mmprojFilename?: string;
}

export interface LLMModelConfig {
	id: string;
	provider: LLMProvider;
	displayName: string;
	sizeGB: number;
	sizeLabel: string;
	description: string;
	contextLength: number;
	defaultMaxNewTokens: number;
	kvBytesPerToken: number;
	requiresWebGPU: boolean;
	minMemoryGB: number;
	qualityScore: number;
	performanceScore: number;
	contextScore: number;
	/**
	 * What the model can do. Required on supported entries — the recommender
	 * ranks on it, so a missing value would silently mean "no abilities".
	 */
	abilities: ModelAbilities;
	/**
	 * Published evals backing `qualityScore`. Absent means the score is a
	 * hand-estimate; the audit reports how much of the catalog is still unsourced.
	 */
	qualityEvidence?: ModelQualityEvidence;
	releaseDate: string;
	quickDownload?: boolean;
	runnerConfig?: TransformerRunnerConfig;
	wllamaConfig?: WllamaModelConfig;
	unsupported?: boolean;
	unsupportedReason?: string;
}

export type LLMModelRunConfig =
	| { provider: "transformer"; model: string }
	| { provider: "webllm"; model: string }
	| { provider: "wllama"; repo: string; filename: string };

export interface ModelRuntimeProfile {
	provider: LLMProvider;
	modelId: string;
	sizeGB: number;
	contextLength: number;
	requiresWebGPU: boolean;
	kvBytesPerToken: number;
}

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
	transformer: "Transformer (WebGPU)",
	webllm: "WebLLM (MLC)",
	wllama: "Wllama (GGUF)",
};

export function getModelRunConfig(model: LLMModelConfig): LLMModelRunConfig {
	if (model.provider === "wllama") {
		if (!model.wllamaConfig?.filename) {
			throw new Error(`Missing wllama filename for model "${model.id}"`);
		}

		return {
			provider: "wllama",
			repo: model.id,
			filename: model.wllamaConfig.filename,
		};
	}

	return {
		provider: model.provider,
		model: model.id,
	};
}

/** Abilities for entries that cannot be loaded at all. */
export const NO_ABILITIES: ModelAbilities = {
	tools: "none",
	vision: false,
	reasoning: false,
	multilingual: false,
};

const EVIDENCE_BENCHMARKS = [
	"mmlu",
	"gpqa",
	"ifeval",
	"humaneval",
	"bfcl",
] as const;

/**
 * Percentile ranking is only meaningful against a real cohort. Below this many
 * models carrying evidence, `deriveQualityScore` stands down and the
 * hand-assigned `qualityScore` is used instead — otherwise the first few
 * models to gain evidence would all collapse to the median and rank *worse*
 * than their un-sourced peers.
 */
export const MIN_EVIDENCE_COHORT = 5;

/**
 * Turns a sparse evidence vector into a 0-100 quality score.
 *
 * Models publish different benchmark subsets, so averaging raw numbers would
 * punish a model for simply not reporting GPQA. Instead each reported
 * benchmark is converted to a percentile *among the models that reported that
 * same benchmark*, and only the present percentiles are averaged. A model
 * reporting only MMLU is therefore ranked on MMLU against its MMLU-reporting
 * peers, with no penalty for the gaps.
 *
 * Returns `null` when the model has no evidence, so callers can fall back to
 * the hand-assigned `qualityScore` rather than inventing a number.
 */
export function deriveQualityScore(
	model: LLMModelConfig,
	catalog: readonly LLMModelConfig[],
): number | null {
	const evidence = model.qualityEvidence;
	if (!evidence) {
		return null;
	}

	const cohort = catalog.filter((candidate) => candidate.qualityEvidence);
	if (cohort.length < MIN_EVIDENCE_COHORT) {
		return null;
	}

	const percentiles: number[] = [];

	for (const benchmark of EVIDENCE_BENCHMARKS) {
		const value = evidence.scores[benchmark];
		if (value === undefined) {
			continue;
		}

		const peers = catalog
			.map((candidate) => candidate.qualityEvidence?.scores[benchmark])
			.filter((score): score is number => score !== undefined);

		// A lone reporter has no peers to rank against; treat it as median
		// rather than as best-in-class, which would be unearned.
		if (peers.length < 2) {
			percentiles.push(50);
			continue;
		}

		const below = peers.filter((peer) => peer < value).length;
		const equal = peers.filter((peer) => peer === value).length;
		percentiles.push(((below + equal / 2) / peers.length) * 100);
	}

	if (percentiles.length === 0) {
		return null;
	}

	const mean =
		percentiles.reduce((total, value) => total + value, 0) / percentiles.length;
	return Math.round(mean);
}

export function getQuickDownloadModelId(model: LLMModelConfig): string {
	if (model.provider === "wllama" && model.wllamaConfig?.filename) {
		return `${model.id}/${model.wllamaConfig.filename}`;
	}

	return model.id;
}
