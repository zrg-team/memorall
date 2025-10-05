import { logInfo } from "@/utils/logger";
import { flowRegistry } from "./flow-registry";

export class FlowsService {
	async initialize(): Promise<void> {
		logInfo("🔄 Initializing Flows service...");
		logInfo("✅ Flows service initialized");
	}

	/**
	 * Create a flow instance using the registry
	 * Type-safe flow creation with proper service verification
	 */
	createGraph<K extends keyof FlowTypeRegistry>(
		flowType: K,
		services: FlowTypeRegistry[K]["services"],
	): FlowTypeRegistry[K]["flow"] {
		return flowRegistry.createFlow(flowType, services);
	}

	/**
	 * Get list of registered flow types
	 */
	getRegisteredFlows(): string[] {
		return flowRegistry.getRegisteredFlowTypes();
	}

	/**
	 * Check if a flow type is registered
	 */
	hasFlow(flowType: string): boolean {
		return flowRegistry.hasFlow(flowType);
	}
}
