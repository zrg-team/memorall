import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { availableHostedApps, loadHostedEngine } from "./engines";
import { hostedEngineServices, hostedFileAccess } from "./flow-files";
import type { MemonHostedAppsPort } from "./hosted-apps-app";

/** The hosted apps on Memorall's files, for a Memon computer. */
export const createHostedAppsPort = (
	fs: IFlowFileSystem,
	subscribe: (listener: () => void) => () => void,
): MemonHostedAppsPort => ({
	available: availableHostedApps,
	files: hostedFileAccess(fs),
	loadEngine: loadHostedEngine,
	services: hostedEngineServices(fs),
	subscribe,
});
