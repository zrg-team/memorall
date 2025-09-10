// WebLLM recommended models - based on prebuiltAppConfig.model_list
export const RECOMMENDATION_WEBLLM_LLMS = [
	"Qwen3-1.7B-q4f16_1-MLC",
	"Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
	"stablelm-2-zephyr-1_6b-q4f16_1-MLC-1k",
	"Phi-3.5-mini-instruct-q4f16_1-MLC-1k",
	"Llama-3.2-3B-Instruct-q4f32_1-MLC",
	"DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
	"SmolLM2-135M-Instruct-q0f16-MLC",
	"SmolLM2-360M-Instruct-q4f16_1-MLC",
	"SmolLM2-1.7B-Instruct-q4f16_1-MLC",
	"gemma-2-2b-it-q4f16_1-MLC",
	"TinyLlama-1.1B-Chat-v0.4-q0f16-MLC",
	"RedPajama-INCITE-Chat-3B-v1-q4f16_1-MLC",
];

// Quick download recommended WebLLM models
export const QUICK_WEBLLM_LLMS = [
	{
		model: "SmolLM2-360M-Instruct-q4f16_1-MLC",
		size: "~400MB",
		description: "Small efficient chat model",
	},
	{
		model: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
		size: "~1.7GB",
		description: "Balanced performance and size",
	},
	{
		model: "Qwen3-1.7B-q4f16_1-MLC",
		size: "~1.2GB",
		description: "Latest Qwen 3 model",
	},
	{
		model: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
		size: "~1.5GB",
		description: "Qwen 2.5 coder optimized",
	},
	{
		model: "Phi-3.5-mini-instruct-q4f16_1-MLC-1k",
		size: "~2.3GB",
		description: "Microsoft Phi 3.5 mini",
	},
	{
		model: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
		size: "~3.5GB",
		description: "Distilled intelligent but larger model",
	},
];
