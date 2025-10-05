import type { AllServices } from "./interfaces/tool";
import type { GraphBase, BaseStateBase } from "./interfaces/graph.base";

// Base interface for all flows - any class extending GraphBase
export type BaseFlow = GraphBase<string, BaseStateBase, AllServices>;

// Global flow type registry for smart type inference
// Flow modules extend this interface to register their flow types and required services
declare global {
	interface FlowTypeRegistry {
		// Empty by default - flows will extend this interface
		// Example: 'knowledge': { services: AllServices; flow: KnowledgeGraphFlow };
	}
}

// Registration interface
export interface FlowRegistration<T extends keyof FlowTypeRegistry> {
	flowType: T;
	factory: (
		services: FlowTypeRegistry[T]["services"],
	) => FlowTypeRegistry[T]["flow"];
}

// Registry class using singleton pattern
export class FlowRegistryManager {
	private static instance: FlowRegistryManager;
	private factories = new Map<string, (services: AllServices) => BaseFlow>();

	private constructor() {}

	static getInstance(): FlowRegistryManager {
		if (!FlowRegistryManager.instance) {
			FlowRegistryManager.instance = new FlowRegistryManager();
		}
		return FlowRegistryManager.instance;
	}

	register<T extends keyof FlowTypeRegistry>(
		registration: FlowRegistration<T>,
	): void {
		this.factories.set(
			registration.flowType as string,
			registration.factory as (services: AllServices) => BaseFlow,
		);
	}

	createFlow<T extends keyof FlowTypeRegistry>(
		flowType: T,
		services: FlowTypeRegistry[T]["services"],
	): FlowTypeRegistry[T]["flow"] {
		const factory = this.factories.get(flowType as string);
		if (!factory) {
			throw new Error(`No flow registered for type: ${String(flowType)}`);
		}
		return factory(services as AllServices) as FlowTypeRegistry[T]["flow"];
	}

	getRegisteredFlowTypes(): string[] {
		return Array.from(this.factories.keys());
	}

	hasFlow(flowType: string): boolean {
		return this.factories.has(flowType);
	}
}

export const flowRegistry = FlowRegistryManager.getInstance();
