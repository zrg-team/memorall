import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { memonConfigFromFlow } from "./feature-config";
import type {
	MemonOperation,
	MemonOperationPayloadMap,
	MemonOperationResultMap,
} from "./operation-types";

export interface MemonRequester {
	request<T extends MemonOperation>(
		operation: T,
		payload: MemonOperationPayloadMap[T],
	): Promise<MemonOperationResultMap[T]>;
}

/**
 * An agent's computer, if it runs, takes the agent's saved MemonOS Bot
 * settings now rather than at its next computer action: an app turned off
 * (pi code) leaves the desktop at once. False when no computer runs or
 * MemonOS Bot is off.
 */
export const applySettingsToRunningComputer = async (
	agentId: string,
	config: UnifiedFlowConfig,
	client?: MemonRequester,
): Promise<boolean> => {
	const memonConfig = memonConfigFromFlow(config);
	if (!memonConfig) return false;
	const requester = client ?? (await import("./memon-client")).memonClient;
	const machines = await requester.request("machines.list", {});
	if (!machines.some((machine) => machine.key === agentId)) return false;
	await requester.request("machine.start", {
		key: agentId,
		config: memonConfig,
		agentId,
	});
	return true;
};
