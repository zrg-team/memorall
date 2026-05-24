import type { UnifiedFlowConfig } from "./flow-config";

export interface FlowCoAgentInfo {
	id: string;
	name: string;
	description?: string | null;
}

export interface IFlowCoAgentService {
	listPredefinedFlows(flowKey: string): Promise<FlowCoAgentInfo[]>;
	getUnifiedFlowConfig(ref: { flowId: string }): Promise<UnifiedFlowConfig>;
	getTopicContextQueries?(topicId?: string): Promise<string[]>;
}
