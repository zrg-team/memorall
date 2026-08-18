import type { GraphTool } from "../graph/graph.base.js";
import type { UnifiedFlowConfig } from "../interfaces/config/flow-config.js";
import type { AllServices } from "../interfaces/services/services.js";
import type {
	BaseGraph,
	ChatGraphResult,
} from "../registries/graph-registry.js";
import {
	defaultRegistries,
	forkFlowRegistries,
	type FlowRegistryForkPredicates,
	type FlowRegistrySet,
} from "../registries/registry-set.js";
import {
	buildDefaultFlowConfig,
	mergeWithDefaultConfig,
} from "../utils/flow-config.js";

export interface FlowEngineOptions {
	source?: FlowRegistrySet;
	filters?: FlowRegistryForkPredicates;
	registries?: FlowRegistrySet;
}

type GraphInstanceConfig<T extends keyof GraphTypeRegistry> =
	GraphTypeRegistry[T] extends { config: infer C } ? C : undefined;

type GraphInstance<T extends keyof GraphTypeRegistry> =
	GraphTypeRegistry[T]["graph"] extends BaseGraph
		? GraphTypeRegistry[T]["graph"]
		: BaseGraph;

export interface FlowEngineGraph<TGraph extends BaseGraph = BaseGraph> {
	raw: TGraph;
	invoke(
		input: Parameters<TGraph["invoke"]>[0],
		options?: Parameters<TGraph["invoke"]>[1],
	): ReturnType<TGraph["invoke"]>;
	stream(
		input: Parameters<TGraph["stream"]>[0],
		options?: Parameters<TGraph["stream"]>[1],
	): Promise<AsyncIterable<unknown>>;
	getGraph(): ReturnType<TGraph["getGraph"]>;
}

export interface FlowEngineChatGraphResult
	extends Omit<ChatGraphResult, "graph"> {
	graph: FlowEngineGraph;
}

export interface FlowEngine {
	registries: FlowRegistrySet;
	buildDefaultConfig(graphType: string): UnifiedFlowConfig;
	mergeWithDefaultConfig(
		saved: Partial<UnifiedFlowConfig>,
		graphType: string,
	): UnifiedFlowConfig;
	createGraph<T extends keyof GraphTypeRegistry>(
		graphType: T,
		services: GraphTypeRegistry[T]["services"],
		config?: GraphInstanceConfig<T>,
	): FlowEngineGraph<GraphInstance<T>>;
	createChatGraph(
		graphType: string,
		services: AllServices,
		config: UnifiedFlowConfig,
	): FlowEngineChatGraphResult;
	filterTools(tools: readonly GraphTool[]): GraphTool[];
	filterConfig(config: UnifiedFlowConfig): UnifiedFlowConfig;
	resolveServices<
		TServices extends Record<string, unknown> = Record<string, unknown>,
	>(
		overrides?: Partial<TServices>,
	): Partial<ServiceRegistry> & Partial<TServices>;
}

const getGraphToolName = (tool: GraphTool): string | undefined => {
	if (typeof tool === "string") return tool;
	if (typeof tool === "object" && tool !== null && "name" in tool) {
		const name = (tool as { name?: unknown }).name;
		return typeof name === "string" ? name : undefined;
	}
	return undefined;
};

const filterTools = (
	tools: readonly GraphTool[],
	registries: FlowRegistrySet,
): GraphTool[] =>
	tools.filter((tool) => {
		const name = getGraphToolName(tool);
		return !name || registries.tools.has(name);
	});

const filterConfig = (
	config: UnifiedFlowConfig,
	registries: FlowRegistrySet,
): UnifiedFlowConfig => ({
	...config,
	steps: config.steps
		.filter((step) => registries.steps.has(step.name))
		.map((step) => {
			if (!step.config || !Array.isArray(step.config.tools)) return step;
			return {
				...step,
				config: {
					...step.config,
					tools: filterTools(step.config.tools as GraphTool[], registries),
				},
			};
		}),
});

const resolveServices = <
	TServices extends Record<string, unknown> = Record<string, unknown>,
>(
	registries: FlowRegistrySet,
	overrides?: Partial<TServices>,
): Partial<ServiceRegistry> & Partial<TServices> =>
	({
		...registries.services.resolveAll(),
		...(overrides ?? {}),
	}) as Partial<ServiceRegistry> & Partial<TServices>;

const createFlowEngineGraph = <TGraph extends BaseGraph>(
	graph: TGraph,
): FlowEngineGraph<TGraph> => ({
	raw: graph,
	invoke: (input, options) =>
		graph.invoke(input, options) as ReturnType<TGraph["invoke"]>,
	stream: (input, options) =>
		graph.stream(input, options) as Promise<AsyncIterable<unknown>>,
	getGraph: () => graph.getGraph() as ReturnType<TGraph["getGraph"]>,
});

export function createFlowEngine(options: FlowEngineOptions = {}): FlowEngine {
	const registries =
		options.registries ??
		forkFlowRegistries(options.source ?? defaultRegistries, options.filters);

	return {
		registries,
		buildDefaultConfig: (graphType) =>
			filterConfig(buildDefaultFlowConfig(graphType, registries), registries),
		mergeWithDefaultConfig: (saved, graphType) =>
			filterConfig(
				mergeWithDefaultConfig(saved, graphType, registries),
				registries,
			),
		createGraph: <T extends keyof GraphTypeRegistry>(
			graphType: T,
			services: GraphTypeRegistry[T]["services"],
			config?: GraphInstanceConfig<T>,
		) => {
			const graph = registries.graphs.createGraph(graphType, services, config, {
				registries,
			});
			return createFlowEngineGraph(graph as GraphInstance<T>);
		},
		createChatGraph: (graphType, services, config) => {
			const result = registries.graphs.createChatGraph(
				graphType,
				services,
				filterConfig(config, registries),
				{ registries },
			);
			return {
				...result,
				graph: createFlowEngineGraph(result.graph),
			};
		},
		filterTools: (tools) => filterTools(tools, registries),
		filterConfig: (config) => filterConfig(config, registries),
		resolveServices: (overrides) => resolveServices(registries, overrides),
	};
}

export const flowEngine = createFlowEngine({ registries: defaultRegistries });
