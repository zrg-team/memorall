// LLM Runner URLs - supports different modes via query params
// Always use bundled runner from extension package
const BASE_RUNNER_URL: string = (() => {
	try {
		return chrome.runtime.getURL("runner/index.html");
	} catch {
		// Fallback for environments where chrome API is not available
		return "runner/index.html";
	}
})();

export type LLMRunnerMode = "wllama" | "webllm" | "embedding";

export const LLM_RUNNER_URLS: Record<LLMRunnerMode, string> = {
	wllama: `${BASE_RUNNER_URL}?mode=wllama`,
	webllm: `${BASE_RUNNER_URL}?mode=webllm`,
	embedding: `${BASE_RUNNER_URL}?mode=embedding`,
};

// Backward compatibility - defaults to wllama mode
export const WLLAMA_RUNNER_URL: string = LLM_RUNNER_URLS.wllama;
