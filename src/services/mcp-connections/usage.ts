/**
 * "Which agents use this connection?" — asked right before someone deletes one,
 * so it is worth answering precisely rather than guessing.
 */

import { serviceManager } from "@/services";
import { MCP_FEATURE_NAME } from "@memorall/agent-harness-flows/steps/features/mcp-feature/index";
import { logError } from "@/utils/logger";
import type { AgentConnectionSelection } from "./types";

export interface ConnectionUsage {
	flowId: string;
	name: string;
}

export async function findAgentsUsingConnection(
	connectionId: string,
): Promise<ConnectionUsage[]> {
	try {
		const flows =
			await serviceManager.flowBuilderService.listPredefinedFlows("foundation");
		const usage: ConnectionUsage[] = [];

		for (const flow of flows) {
			try {
				const config =
					await serviceManager.flowBuilderService.getUnifiedFlowConfig({
						flowId: flow.id,
					});
				const step = config.steps.find(
					(candidate) => candidate.name === MCP_FEATURE_NAME,
				);
				const selections = step?.config?.connections;
				if (!Array.isArray(selections)) continue;

				const uses = (selections as AgentConnectionSelection[]).some(
					(selection) => selection?.connectionId === connectionId,
				);
				if (uses) {
					usage.push({ flowId: flow.id, name: flow.name ?? flow.id });
				}
			} catch {
				// A single unreadable flow should not blank out the whole list.
			}
		}

		return usage;
	} catch (error) {
		logError("[MCP_CONNECTIONS] Failed to resolve connection usage:", error);
		return [];
	}
}
