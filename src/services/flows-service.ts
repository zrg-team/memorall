import { logInfo } from "@/services/flows-legacy/utils/logger";
import { graphRegistry } from "@/services/flows-legacy/registries/graph-registry";

export class FlowsService {
	async initialize(): Promise<void> {
		logInfo("🔄 Initializing Flows service...");
		logInfo("✅ Flows service initialized");
	}

	/**
	 * Create a graph instance using the registry.
	 */
	createGraph<K extends keyof GraphTypeRegistry>(
		graphType: K,
		services: GraphTypeRegistry[K]["services"],
		config?: GraphTypeRegistry[K] extends { config: infer C } ? C : undefined,
	): GraphTypeRegistry[K]["graph"] {
		return graphRegistry.createGraph(graphType, services, config);
	}

	/**
	 * Get list of registered graph types.
	 */
	getRegisteredGraphs(): string[] {
		return graphRegistry.getRegisteredGraphs();
	}

	/**
	 * Check if a graph type is registered.
	 */
	hasGraph(graphType: string): boolean {
		return graphRegistry.hasGraph(graphType);
	}
}
