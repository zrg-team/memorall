import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { MemonPiCodePort } from "./pi-code-app";

/**
 * Starts pi on the machine's own services: the Memon file system, the
 * sandbox the Terminal uses and the chat's LLM. pi is loaded on first use,
 * so machines that never open it do not carry it.
 */
export const createPiCodePort = (deps: {
	fs: () => IFlowFileSystem;
	sandbox: () => Promise<IAgentSandboxService>;
}): MemonPiCodePort => ({
	async start(options) {
		const [
			{ PiCodeSession },
			{ serviceManager },
			{ reasoningEffortKey, reasoningEffortSettings },
		] = await Promise.all([
			import("./host/pi-code-session"),
			import("@/services"),
			import("@/services/llm/reasoning-effort-settings"),
		]);
		return PiCodeSession.start({
			...options,
			theme: "dark",
			fs: deps.fs(),
			getSandbox: deps.sandbox,
			getLlm: async () => serviceManager.getLLMService(),
			getReasoningEffort: (provider, modelId) =>
				reasoningEffortSettings.get(reasoningEffortKey({ provider, modelId })),
		});
	},
});
