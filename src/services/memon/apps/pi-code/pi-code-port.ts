import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { MEMON_CODE_TOOL, memonDisplayPath } from "../../constants";
import { PI_CODE_USAGE_SOURCE } from "@/services/model-usage/model-usage-ledger";
import type { MemonModelsPort } from "../../models-port";
import type { PiCodeSession } from "./host/pi-code-session";
import type { MemonPiCodePort } from "./pi-code-app";

/**
 * Starts pi on the machine's own services: the Memon file system, the
 * sandbox the Terminal uses and the chat's LLM, metered through the models
 * port: every pi request is booked to its pi session, the agent and the
 * memon_code tool. pi is loaded on first use, so machines that never open
 * it do not carry it.
 */
export const createPiCodePort = (deps: {
	fs: () => IFlowFileSystem;
	sandbox: () => Promise<IAgentSandboxService>;
	models: MemonModelsPort;
}): MemonPiCodePort => ({
	async start(options) {
		const [{ PiCodeSession }, { reasoningEffortKey, reasoningEffortSettings }] =
			await Promise.all([
				import("./host/pi-code-session"),
				import("@/services/llm/reasoning-effort-settings"),
			]);
		let session: PiCodeSession | undefined;
		const llm = await deps.models.llm(() => ({
			source: PI_CODE_USAGE_SOURCE,
			tool: MEMON_CODE_TOOL,
			agentId: options.agentId,
			sessionId: session?.sessionId ?? options.sandboxSessionKey,
			title: `pi code · ${memonDisplayPath(session?.cwd ?? options.cwd ?? options.home, options.home)}`,
		}));
		session = await PiCodeSession.start({
			...options,
			theme: "dark",
			fs: deps.fs(),
			getSandbox: deps.sandbox,
			getLlm: async () => llm,
			getReasoningEffort: (provider, modelId) =>
				reasoningEffortSettings.get(reasoningEffortKey({ provider, modelId })),
		});
		return session;
	},
	async folders(home, cwd) {
		const { listSavedFolders } = await import("./host/saved-folders");
		return listSavedFolders(deps.fs(), home, cwd);
	},
});
