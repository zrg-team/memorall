import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { platform } from "@/platform/current";
import { FX_USAGE_SOURCE } from "@/services/model-usage/model-usage-ledger";
import { memonDisplayPath } from "../../constants";
import type { MemonSkillsPort } from "../../memon-machine";
import type { MemonModelsPort } from "../../models-port";
import type { MemonFxPort } from "./fx-app";

/** Where tools/copy-bundled-assets.mjs puts libfx's terminal. */
export const FX_TERMINAL_WASM_ASSET = "vendors/fx/fx-term.wasm";

/**
 * Starts fx on the machine's own services: the Memon file system, the sandbox
 * the Terminal uses, the agent's skills and the chat's models, metered
 * through the models port: every fx request is booked to its fx session and
 * the agent. libfx is loaded on first use, so machines that never open fx do
 * not carry it.
 */
export const createFxPort = (deps: {
	fs: () => IFlowFileSystem;
	sandbox: () => Promise<IAgentSandboxService>;
	models: MemonModelsPort;
	skills?: Pick<MemonSkillsPort, "list" | "read">;
}): MemonFxPort => ({
	async start(options) {
		const { FxSession } = await import("./fx-session");
		let sessionId = options.sandboxSessionKey;
		const llm = deps.models.llm(() => ({
			source: FX_USAGE_SOURCE,
			agentId: options.agentId,
			sessionId,
			title: `fx · ${memonDisplayPath(options.cwd, options.home)}`,
		}));
		const session = await FxSession.start({
			home: options.home,
			cwd: options.cwd,
			agentId: options.agentId,
			sandboxSessionKey: options.sandboxSessionKey,
			continueLast: options.continueLast,
			fs: deps.fs(),
			getSandbox: deps.sandbox,
			models: () => llm,
			skills: deps.skills,
			wasmUrl: platform.assets.url(FX_TERMINAL_WASM_ASSET),
			onSession: (id) => {
				sessionId = id;
			},
			onExit: options.onExit,
			onChange: options.onChange,
		});
		return session;
	},
	async folders(home) {
		const { listFxFolders } = await import("./fx-stores");
		return listFxFolders(deps.fs(), home);
	},
});
