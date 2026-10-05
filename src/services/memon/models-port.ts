import type { MeteredLlmService } from "@/services/model-usage/metered-llm";
import type { ModelUsageScope } from "@/services/model-usage/model-usage-ledger";

/**
 * The one way MemonOS reaches the models. Every model request made through
 * it is booked to its scope in the model usage ledger, so the Usage page
 * counts what pi code and Studio spend on a computer next to the chat's own
 * replies. MemonOS code never calls the LLM service directly; a test holds
 * it to that.
 */
export interface MemonModelsPort {
	/** The LLM service, metered to `scope` (read at each request). */
	llm(scope: () => ModelUsageScope): Promise<MeteredLlmService>;
}

export const createMemonModelsPort = (): MemonModelsPort => ({
	async llm(scope) {
		const [{ serviceManager }, { meterLlmService }] = await Promise.all([
			import("@/services"),
			import("@/services/model-usage/metered-llm"),
		]);
		return meterLlmService(serviceManager.getLLMService(), scope);
	},
});
