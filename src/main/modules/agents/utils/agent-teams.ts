import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { MULTI_AGENT_FEATURE_NAME } from "@memorall/agent-harness-flows/steps/features/multi-agent-feature/index";

/**
 * The agents this one can hand work to: Multi-Agent Delegation's list, and
 * only while the feature is on. Empty for an agent that works alone.
 */
export const agentTeamOf = (config: UnifiedFlowConfig): string[] => {
	const step = config.steps.find(
		(candidate) => candidate.name === MULTI_AGENT_FEATURE_NAME,
	);
	if (!step?.enabled) return [];
	const ids = step.config?.accessibleAgentIds;
	return Array.isArray(ids)
		? [
				...new Set(
					ids.filter((id): id is string => typeof id === "string" && !!id),
				),
			]
		: [];
};
