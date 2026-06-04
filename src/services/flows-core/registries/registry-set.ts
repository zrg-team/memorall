import {
	graphRegistry,
	GraphRegistryManager,
	type GraphRegistryPredicate,
} from "flow-core/registries/graph-registry";
import {
	serviceRegistry,
	ServiceRegistryManager,
	type ServiceRegistryPredicate,
} from "flow-core/registries/service-registry";
import {
	stepRegistry,
	StepRegistryManager,
	type StepRegistryPredicate,
} from "flow-core/registries/step-registry";
import {
	toolRegistry,
	ToolRegistryManager,
	type ToolRegistryPredicate,
} from "flow-core/registries/tool-registry";

export interface FlowRegistrySet {
	services: ServiceRegistryManager;
	tools: ToolRegistryManager;
	steps: StepRegistryManager;
	graphs: GraphRegistryManager;
}

export interface FlowRegistryForkPredicates {
	services?: ServiceRegistryPredicate;
	tools?: ToolRegistryPredicate;
	steps?: StepRegistryPredicate;
	graphs?: GraphRegistryPredicate;
}

export const defaultRegistries: FlowRegistrySet = {
	services: serviceRegistry,
	tools: toolRegistry,
	steps: stepRegistry,
	graphs: graphRegistry,
};

export function createFlowRegistries(): FlowRegistrySet {
	return {
		services: new ServiceRegistryManager(),
		tools: new ToolRegistryManager(),
		steps: new StepRegistryManager(),
		graphs: new GraphRegistryManager(),
	};
}

export function forkFlowRegistries(
	source: FlowRegistrySet = defaultRegistries,
	predicates: FlowRegistryForkPredicates = {},
): FlowRegistrySet {
	return {
		services: source.services.fork(predicates.services),
		tools: source.tools.fork(predicates.tools),
		steps: source.steps.fork(predicates.steps),
		graphs: source.graphs.fork(predicates.graphs),
	};
}

export function finalizeFlowRegistries(
	registries: FlowRegistrySet,
): FlowRegistrySet {
	registries.services.finalize();
	registries.tools.finalize();
	registries.steps.finalize();
	registries.graphs.finalize();
	return registries;
}
