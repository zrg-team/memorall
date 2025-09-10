export const RECOMMENDATION_WALLAMA_LLMS: string[] = [
	"LiquidAI/LFM2-VL-450M-GGUF",
	"LiquidAI/LFM2-VL-1.6B-GGUF",
	"LiquidAI/LFM2-1.2B-GGUF",
	"ggml-org/SmolLM3-3B-GGUF",
	"LiquidAI/LFM2-700M-GGUF",
	"ggml-org/Qwen3-1.7B-GGUF",
	"unsloth/gemma-3-1b-it-GGUF",
	"unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF",
	"bartowski/Llama-3.2-1B-Instruct-GGUF",
	"unsloth/Qwen3-1.7B-GGUF",
	"unsloth/Qwen3-0.6B-GGUF",
	"unsloth/Qwen3-4B-GGUF",
	"unsloth/Phi-4-mini-reasoning-GGUF",
	"unsloth/gemma-3-270m-it-GGUF",
	"LiquidAI/LFM2-350M-GGUF",
	"gabriellarson/LFM2-VL-450M-GGUF",
];

// Quick download recommended models
export const QUICK_WALLAMA_LLMS = [
	{
		repo: "LiquidAI/LFM2-VL-450M-GGUF",
		filename: "LFM2-VL-450M-Q4_0.gguf",
		size: "263MB",
		description: "Compact vision-language model",
	},
	{
		repo: "LiquidAI/LFM2-700M-GGUF",
		filename: "LFM2-700M-Q4_0.gguf",
		size: "410MB",
		description: "Balanced performance model",
	},
	{
		repo: "LiquidAI/LFM2-1.2B-GGUF",
		filename: "LFM2-1.2B-Q4_0.gguf",
		size: "709MB",
		description: "Large language model",
	},
	{
		repo: "LiquidAI/LFM2-VL-1.6B-GGUF",
		filename: "LFM2-VL-1.6B-Q4_0.gguf",
		size: "952MB",
		description: "Advanced vision-language model",
	},
];
