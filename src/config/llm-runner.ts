// LLM Runner URLs - supports different modes via query params
const BASE_RUNNER_URL: string =
	import.meta.env.EXTENSION_PUBLIC_LLM_RUNNER_URL ||
	"http://localhost:34115/index.html";

export type LLMRunnerMode = "wllama" | "webllm" | "embedding";

export const LLM_RUNNER_URLS: Record<LLMRunnerMode, string> = {
	wllama: `${BASE_RUNNER_URL}?mode=wllama`,
	webllm: `${BASE_RUNNER_URL}?mode=webllm`,
	embedding: `${BASE_RUNNER_URL}?mode=embedding`,
};

// Backward compatibility - defaults to wllama mode
export const WLLAMA_RUNNER_URL: string = LLM_RUNNER_URLS.wllama;
