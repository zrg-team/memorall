import type { ModelAbilities } from "@/services/llm/interfaces/llm-model-config";

/**
 * System specifications detected from the user's device
 */
export interface SystemSpecs {
	/** Total RAM in GB (approximate) */
	memoryGB: number;
	/** Number of logical CPU cores */
	cpuCores: number;
	/** Whether WebGPU is available */
	hasWebGPU: boolean;
	/**
	 * Whether the origin private file system is available. GGUF (Wllama) models
	 * are stored there, so without it those models cannot be downloaded at all.
	 */
	hasOpfs: boolean;
	/** GPU information if available */
	gpu?: {
		vendor: string;
		renderer: string;
		/**
		 * VRAM in GB guessed from the renderer string. This is a lookup against a
		 * hand-kept table, so it is absent for any card the table has not caught
		 * up with, and meaningless for the integrated GPUs that share system RAM.
		 * Treat it as a label, never as a budget.
		 */
		estimatedVRAM?: number;
	};
	/**
	 * The largest single GPU allocation this device admits, straight from the
	 * WebGPU adapter. WebGPU deliberately never reports VRAM — this limit is the
	 * only memory number it guarantees, and llama.cpp's WebGPU backend budgets
	 * against exactly this figure.
	 */
	webgpuMaxAllocationBytes?: number;
	/**
	 * Origin storage quota. An upper bound on the model weights that can be
	 * cached at all, whatever the memory situation.
	 */
	storageQuotaBytes?: number;
	/** Device category based on specs */
	deviceCategory: "low" | "medium" | "high" | "ultra";
}

/**
 * User's preference for model selection
 */
export type ModelPreference = "performance" | "quality" | "context" | "balance";

/**
 * Model recommendation with performance estimates
 */
export interface ModelRecommendation {
	/** Provider that hosts this model */
	provider: "transformer" | "wllama" | "webllm" | "lmstudio" | "ollama";
	/** Provider display name */
	providerName: string;
	/** Model identifier */
	modelId: string;
	/** Display name for the model */
	displayName: string;
	/** Model size in human-readable format */
	size: string;
	/** Model size in GB for calculations */
	sizeGB: number;
	/** Estimated tokens per second on user's device */
	estimatedTokensPerSecond: number;
	/** Maximum context length */
	contextLength: number;
	/** Why this model was recommended */
	reason: string;
	/** Model release date (for showing recency) */
	releaseDate: string;
	/** Whether this uses WebGPU acceleration */
	usesWebGPU: boolean;
	/**
	 * KV cache bytes per token at full fp16 precision.
	 * Formula: 2 (K+V) × nLayers × nKvHeads × headDim × 2 bytes
	 * Used for accurate VRAM estimation at any context length.
	 */
	kvBytesPerToken: number;
	/** What the model can do — surfaced as badges and used in scoring. */
	abilities: ModelAbilities;
	/** Model configuration for download */
	config: ModelConfig;
}

/**
 * Configuration needed to download/load a model
 */
export type ModelConfig =
	| {
			provider: "transformer";
			model: string;
	  }
	| {
			provider: "wllama";
			repo: string;
			filename: string;
	  }
	| {
			provider: "webllm";
			model: string;
	  }
	| {
			provider: "lmstudio" | "ollama";
			modelId: string;
	  };

/**
 * Recommendation set covering every preference.
 * Keyed by `ModelPreference` so adding a preference cannot leave a gap here.
 */
export type RecommendationSet = Record<
	ModelPreference,
	{
		primary: ModelRecommendation;
		alternatives: ModelRecommendation[];
	}
>;
