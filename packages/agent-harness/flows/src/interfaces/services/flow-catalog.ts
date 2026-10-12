import type { UnifiedFlowConfig } from "../config/flow-config.js";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

export interface FlowInfo {
	id: string;
	name: string;
	description?: string | null;
}

export interface IFlowCatalogService {
	/** List saved flows belonging to a named group, e.g. "foundation". */
	listFlows(groupKey: string): Promise<FlowInfo[]>;
	/** Get the execution config for a specific saved flow. */
	getFlowConfig(ref: { flowId: string }): Promise<UnifiedFlowConfig>;
	/** Host-owned agent context for a delegated run, isolated from its parent. */
	getRunConfig?(
		ref: { flowId: string },
		parentConfig?: LangGraphRunnableConfig,
	): LangGraphRunnableConfig;
}

declare global {
	interface ServiceRegistry {
		flowCatalog?: IFlowCatalogService;
	}
}
