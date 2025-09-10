// LLM Runner URLs - supports different modes via query params
const BASE_RUNNER_URL =
	(import.meta as any).env?.EXTENSION_PUBLIC_LLM_RUNNER_URL ||
	"http://localhost:34115/index.html";

export const LLM_RUNNER_URLS = {
	wllama: `${BASE_RUNNER_URL}?mode=wllama`,
	webllm: `${BASE_RUNNER_URL}?mode=webllm`,
	embedding: `${BASE_RUNNER_URL}?mode=embedding`,
} as Record<string, string>;

// Backward compatibility - defaults to wllama mode
export const WLLAMA_RUNNER_URL = LLM_RUNNER_URLS.wllama;
