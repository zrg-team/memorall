import type {
	SystemSpecs,
	ModelRecommendation,
	RecommendationSet,
	ModelPreference,
} from "../types/system-specs";
import { getAvailableModelMemoryGB, estimateModelMemory } from "./model-memory";
import {
	ALL_MODELS,
	getModelRunProfile,
} from "@/services/llm/registry/model-registry";
import {
	PROVIDER_NAMES,
	deriveQualityScore,
	type LLMModelConfig,
	type LLMProvider,
} from "@/services/llm/interfaces/llm-model-config";
import type { ToolSupportMode } from "@/services/llm/interfaces/tool-capability";

const PROVIDER_INFO: Record<
	LLMProvider,
	{ speedMultiplier: number; requiresWebGPU: boolean; note: string }
> = {
	transformer: {
		requiresWebGPU: true,
		speedMultiplier: 1.4,
		note: "ONNX models with WebGPU acceleration",
	},
	webllm: {
		requiresWebGPU: true,
		speedMultiplier: 1.5,
		note: "Highly optimized WebGPU models",
	},
	wllama: {
		requiresWebGPU: false,
		speedMultiplier: 1.0,
		note: "CPU-based, works everywhere",
	},
};

/**
 * A model that can only hold a couple of hundred tokens of context is not
 * usable for chat, whatever its other merits.
 */
const MIN_USABLE_CONTEXT_TOKENS = 2048;

/**
 * Ability bonuses, in the same units as the doubled preference score — so +8
 * is worth exactly 4 quality points. Good models cluster in the 70-92 band
 * where 4 points is a common gap, which makes native tool support decisive
 * between near-equals without letting a weak tool-capable model beat a
 * clearly stronger one.
 */
const TOOL_BONUS: Record<ToolSupportMode, number> = {
	native: 8,
	prompt_injection: 2,
	none: 0,
};

/** Thinking costs latency, so it only helps where the user asked for depth. */
const REASONING_BONUS = 3;

/**
 * Recency is a *sliding* 24-month window ending today, not a cap measured from
 * a fixed epoch. A fixed cap saturates: `min(monthsSince2024, 24)` pins every
 * model released after 2025-12 to the same value, so the whole 2026 cohort
 * ties and the signal dies a little more each month.
 *
 * The window is worth at most +12, down from the old uncapped `months * 0.8`
 * which handed a 2026-02 model +20.8 — more than a 10-point quality gap.
 */
const RECENCY_WINDOW_MONTHS = 24;
const RECENCY_PER_MONTH = 0.5;

function recencyBonus(releaseDate: string, now: Date): number {
	const [year, month] = releaseDate.split("-").map(Number);
	if (!Number.isFinite(year) || !Number.isFinite(month)) {
		return 0;
	}

	const releasedMonths = year * 12 + month;
	const nowMonths = now.getFullYear() * 12 + (now.getMonth() + 1);
	const ageMonths = nowMonths - releasedMonths;

	// Newest models get the full window; anything older than the window, or
	// dated in the future by a typo, contributes nothing rather than negative.
	const withinWindow = Math.max(
		0,
		Math.min(RECENCY_WINDOW_MONTHS, RECENCY_WINDOW_MONTHS - ageMonths),
	);
	return withinWindow * RECENCY_PER_MONTH;
}

/**
 * "Balance" wants models that are decent on every axis, so the axes multiply
 * rather than add — one bad axis drags the whole score down.
 *
 * Context is deliberately down-weighted: `contextScore` is a coarse step
 * function, and for WebLLM it reflects MLC's compiled 4096-token cap rather
 * than anything about the model. With equal weights, LFM2 350M (quality 40,
 * context 98) outranks Gemma 3 1B (quality 77, context 50) — a packaging
 * artifact beating real capability. At 0.4/0.4/0.2 that inverts correctly.
 */
const BALANCE_WEIGHTS = { quality: 0.4, performance: 0.4, context: 0.2 };

/**
 * Quality from published evals where the model has them, falling back to the
 * hand-assigned estimate otherwise. `deriveQualityScore` stands down until
 * enough of the catalog carries evidence to make percentile ranking mean
 * something, so this is safe to call on a mostly-unsourced catalog.
 */
function effectiveQualityScore(model: LLMModelConfig): number {
	return deriveQualityScore(model, ALL_MODELS) ?? model.qualityScore;
}

function balanceScore(model: LLMModelConfig): number {
	return (
		effectiveQualityScore(model) ** BALANCE_WEIGHTS.quality *
		model.performanceScore ** BALANCE_WEIGHTS.performance *
		model.contextScore ** BALANCE_WEIGHTS.context
	);
}

function preferenceScore(
	model: LLMModelConfig,
	preference: ModelPreference,
): number {
	switch (preference) {
		case "performance":
			return model.performanceScore;
		case "quality":
			return effectiveQualityScore(model);
		case "context":
			return model.contextScore;
		case "balance":
			return balanceScore(model);
	}
}

function scoreModel(
	model: LLMModelConfig,
	preference: ModelPreference,
	specs: SystemSpecs,
	now: Date,
): number {
	let score = preferenceScore(model, preference) * 2;

	// Newer is better, but only up to a point.
	score += recencyBonus(model.releaseDate, now);

	// Abilities. A model that can call tools is more useful than one that
	// cannot, regardless of which axis the user optimised for — the default
	// agent's render_artifact tool is unusable without them.
	score += TOOL_BONUS[model.abilities.tools];

	if (
		model.abilities.reasoning &&
		(preference === "quality" || preference === "balance")
	) {
		score += REASONING_BONUS;
	}

	// Vision is deliberately unweighted: it is orthogonal to chat quality, and
	// rewarding it would push VL models ahead of better text models.

	if (specs.hasWebGPU && model.requiresWebGPU) {
		score += 10;
	}

	if (specs.hasWebGPU) {
		if (model.provider === "webllm") {
			score += 5;
		} else if (model.provider === "transformer") {
			score += 3;
		}
	}

	if (specs.deviceCategory === "ultra" || specs.deviceCategory === "high") {
		score += model.sizeGB > 1.0 ? 5 : 0;
	} else if (specs.deviceCategory === "low") {
		score += model.sizeGB < 0.5 ? 8 : 0;
	}

	return score;
}

/**
 * Generates model recommendations based on system specs and user preference.
 * Returns top N models sorted by score.
 */
export function generateRecommendations(
	specs: SystemSpecs,
	preference: ModelPreference,
	limit: number = 4,
): ModelRecommendation[] {
	const compatibleModels = ALL_MODELS.filter((model) => {
		if (model.unsupported) {
			return false;
		}

		if (model.requiresWebGPU && !specs.hasWebGPU) {
			return false;
		}

		// GGUF weights live in the origin private file system; without it the
		// download fails inside the runtime, so never recommend one.
		if (model.provider === "wllama" && !specs.hasOpfs) {
			return false;
		}

		if (model.minMemoryGB > specs.memoryGB) {
			return false;
		}

		// Probe at the model's own context, which is what MagicSetup renders the
		// fit badge against. Probing at a fixed 4096 used to let models through
		// the filter and then show them as "Low RAM" — the filter and the badge
		// now agree.
		const availableGB = getAvailableModelMemoryGB(specs, model.requiresWebGPU);
		const estimate = estimateModelMemory(
			model.sizeGB,
			model.kvBytesPerToken,
			model.contextLength,
			availableGB,
		);

		// A model whose weights alone do not fit is unusable; one that only
		// overflows on KV cache is still usable at a shorter context.
		return estimate.feasibleContext >= MIN_USABLE_CONTEXT_TOKENS;
	});

	if (compatibleModels.length === 0) {
		return [];
	}

	// One clock read for the whole pass, so ranking cannot shift mid-sort.
	const now = new Date();
	const scoredModels = compatibleModels.map((model) => ({
		model,
		score: scoreModel(model, preference, specs, now),
	}));

	scoredModels.sort(
		(a, b) =>
			// Explicit tiebreak on size rather than relying on Array.sort
			// stability, so the ranking does not depend on registry order.
			b.score - a.score || a.model.sizeGB - b.model.sizeGB,
	);

	// The same model is often catalogued under two or three runtimes, so an
	// undeduped list shows "Qwen 3 1.7B" three times and buries genuinely
	// different options. Keep the highest-scoring runtime for each model —
	// the list is already sorted, so first occurrence wins.
	const seenDisplayNames = new Set<string>();
	const distinctModels = scoredModels.filter(({ model }) => {
		const key = model.displayName.toLowerCase();
		if (seenDisplayNames.has(key)) {
			return false;
		}
		seenDisplayNames.add(key);
		return true;
	});

	const topMatches = distinctModels.slice(
		0,
		Math.min(limit, distinctModels.length),
	);

	return topMatches.flatMap(({ model }) => {
		const config = getModelRunProfile(model.id, model.provider);
		if (!config) {
			return [];
		}

		const estimatedTokensPerSecond = estimateTokensPerSecond(specs, model);
		const reason = generateReason(preference, specs, model);

		return [
			{
				provider: model.provider,
				providerName: PROVIDER_NAMES[model.provider],
				modelId: model.id,
				displayName: model.displayName,
				size: model.sizeLabel,
				sizeGB: model.sizeGB,
				estimatedTokensPerSecond,
				contextLength: model.contextLength,
				reason,
				releaseDate: model.releaseDate,
				usesWebGPU: model.requiresWebGPU && specs.hasWebGPU,
				kvBytesPerToken: model.kvBytesPerToken,
				abilities: model.abilities,
				config,
			},
		];
	});
}

export const MODEL_PREFERENCES: readonly ModelPreference[] = [
	"performance",
	"balance",
	"quality",
	"context",
];

/**
 * Generates a recommendation for every preference.
 * Each preference gets a primary recommendation and all compatible alternatives.
 */
export function generateAllRecommendations(
	specs: SystemSpecs,
): RecommendationSet | null {
	const lists = MODEL_PREFERENCES.map(
		(preference) =>
			[preference, generateRecommendations(specs, preference, 50)] as const,
	);

	// The hard filter is preference-independent, so either every list has
	// candidates or none do — but bail on any empty list rather than hand back
	// a half-populated set the UI would have to guard.
	if (lists.some(([, list]) => list.length === 0)) {
		return null;
	}

	return Object.fromEntries(
		lists.map(([preference, list]) => [
			preference,
			{ primary: list[0], alternatives: list.slice(1) },
		]),
	) as RecommendationSet;
}

function estimateTokensPerSecond(
	specs: SystemSpecs,
	model: LLMModelConfig,
): number {
	let baseSpeed = 0;

	switch (specs.deviceCategory) {
		case "ultra":
			baseSpeed = model.requiresWebGPU ? 20 : 4;
			break;
		case "high":
			baseSpeed = model.requiresWebGPU ? 12 : 3;
			break;
		case "medium":
			baseSpeed = model.requiresWebGPU ? 6 : 2;
			break;
		case "low":
			baseSpeed = model.requiresWebGPU ? 3 : 1;
			break;
	}

	const sizeMultiplier = Math.max(0.4, 1 - model.sizeGB * 0.1);
	const providerMultiplier = PROVIDER_INFO[model.provider].speedMultiplier;
	return Math.max(
		1,
		Math.round(baseSpeed * sizeMultiplier * providerMultiplier),
	);
}

function generateReason(
	preference: ModelPreference,
	specs: SystemSpecs,
	model: LLMModelConfig,
): string {
	const deviceDesc =
		specs.deviceCategory === "ultra"
			? "high-end"
			: specs.deviceCategory === "high"
				? "powerful"
				: specs.deviceCategory === "medium"
					? "capable"
					: "modest";

	const gpuNote =
		model.requiresWebGPU && specs.hasWebGPU ? " with WebGPU acceleration" : "";

	const [year, month] = model.releaseDate.split("-");
	const monthName = new Date(`${year}-${month}-01`).toLocaleString("en", {
		month: "short",
		year: "numeric",
	});
	const releaseNote = ` Released ${monthName}.`;

	// Abilities are the part of the reason a user cannot infer from the size
	// and speed figures already on the card, so name them explicitly.
	const toolNote =
		model.abilities.tools === "native"
			? " Calls tools natively."
			: model.abilities.tools === "none"
				? " Cannot use tools."
				: "";

	switch (preference) {
		case "performance":
			return `Fastest model for your ${deviceDesc} device${gpuNote}. Optimized for quick responses.${toolNote}${releaseNote}`;
		case "quality":
			return `Best quality model for your ${deviceDesc} device${gpuNote}. Excellent reasoning and accuracy.${toolNote}${releaseNote}`;
		case "context":
			return `Maximum context window (${model.contextLength.toLocaleString()} tokens) for handling long documents and conversations${gpuNote}.${toolNote}${releaseNote}`;
		case "balance":
			return `Solid all-rounder for your ${deviceDesc} device${gpuNote} — good quality without giving up speed or context.${toolNote}${releaseNote}`;
	}
}
