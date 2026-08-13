import { platform } from "@/platform/current";

// LLM Runner URLs - supports different modes via query params.
const BASE_RUNNER_URL = platform.assets.url("runner/index.html");

export type LLMRunnerMode = "wllama" | "webllm" | "embedding" | "transformer";

export const LLM_RUNNER_URLS: Record<LLMRunnerMode, string> = {
	wllama: `${BASE_RUNNER_URL}?mode=wllama`,
	webllm: `${BASE_RUNNER_URL}?mode=webllm`,
	embedding: `${BASE_RUNNER_URL}?mode=embedding`,
	transformer: `${BASE_RUNNER_URL}?mode=transformer`,
};

// Backward compatibility - defaults to wllama mode
export const WLLAMA_RUNNER_URL: string = LLM_RUNNER_URLS.wllama;
