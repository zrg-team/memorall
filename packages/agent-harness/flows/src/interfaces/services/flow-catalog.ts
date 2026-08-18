import type { UnifiedFlowConfig } from "../config/flow-config.js";
import { serviceRegistry } from "../../registries/service-registry.js";

serviceRegistry.registerSchema("flowCatalog", {
	name: "Flow Catalog Service",
	config: { required: false, category: "core" },
	metadata: { description: "Saved flow lookup service" },
});

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
}

declare global {
	interface ServiceRegistry {
		flowCatalog?: IFlowCatalogService;
	}
}
