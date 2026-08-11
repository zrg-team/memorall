import type {} from "@/services/flows-legacy/interfaces/engine/tool";
import type { ChatCompletionMessageParam } from "@/services/flows-legacy/interfaces/engine/messages";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import type {
	GraphBase,
	BaseStateBase,
} from "@/services/flows-legacy/graph/graph.base";
import type { FlowRegistrySet } from "@/services/flows-legacy/registries/registry-set";

export type BaseGraph = GraphBase<any, any, unknown>;

export const FEATURE_SLOT = "__features__" as const;
export type StepSlot = string | typeof FEATURE_SLOT;

type GraphInstanceConfig<T extends keyof GraphTypeRegistry> =
	GraphTypeRegistry[T] extends { config: infer C } ? C : undefined;

declare global {
	interface GraphTypeRegistry {
		// Empty by default - graph modules extend this interface.
	}
}

export type { UnifiedFlowConfig };

export interface GraphFactoryContext {
	registries: FlowRegistrySet;
}

export interface ChatGraphContext {
	messages: ChatCompletionMessageParam[];
	topicId?: string;
	contextQueries: string[];
}

export interface ChatGraphResult {
	graph: BaseGraph;
	getInitialState(ctx: ChatGraphContext): Record<string, unknown>;
}

export type ChatGraphFactory = (
	services: AllServices,
	config: UnifiedFlowConfig,
	context?: GraphFactoryContext,
) => ChatGraphResult;

export interface GraphConfig {
	stepOrder: readonly StepSlot[];
	stepDefaults?: Record<string, Record<string, unknown>>;
	chat?: ChatGraphFactory;
	[key: string]: unknown;
}

export interface GraphRegistration<T extends keyof GraphTypeRegistry> {
	id: T;
	name?: string;
	factory: (
		services: GraphTypeRegistry[T]["services"],
		config?: GraphInstanceConfig<T>,
		context?: GraphFactoryContext,
	) => GraphTypeRegistry[T]["graph"];
	config: GraphConfig;
	metadata?: Record<string, unknown>;
}

export interface RegisteredGraph {
	id: string;
	name: string;
	factory: (
		services: AllServices,
		config?: unknown,
		context?: GraphFactoryContext,
	) => BaseGraph;
	config: GraphConfig;
	metadata: Record<string, unknown>;
}

export type GraphRegistryPredicate = (entry: RegisteredGraph) => boolean;

export class GraphRegistryManager {
	private static instance: GraphRegistryManager;
	private entries = new Map<string, RegisteredGraph>();
	private finalized = false;

	constructor() {}

	private assertMutable(action: string): void {
		if (this.finalized) {
			throw new Error(`[GraphRegistry] Cannot ${action} after finalization`);
		}
	}

	finalize(): this {
		this.finalized = true;
		return this;
	}

	isFinalized(): boolean {
		return this.finalized;
	}

	static getInstance(): GraphRegistryManager {
		if (!GraphRegistryManager.instance) {
			GraphRegistryManager.instance = new GraphRegistryManager();
		}
		return GraphRegistryManager.instance;
	}

	register<T extends keyof GraphTypeRegistry>(
		id: T,
		factory: GraphRegistration<T>["factory"],
		config: GraphConfig,
		metadata?: Record<string, unknown>,
	): void;
	register<T extends keyof GraphTypeRegistry>(
		registration: GraphRegistration<T>,
	): void;
	register<T extends keyof GraphTypeRegistry>(
		registrationOrId: T | GraphRegistration<T>,
		factory?: GraphRegistration<T>["factory"],
		config?: GraphConfig,
		metadata?: Record<string, unknown>,
	): void {
		this.assertMutable("register graph");
		const registration =
			typeof registrationOrId === "string"
				? ({
						id: registrationOrId,
						factory: factory!,
						config: config!,
						metadata,
					} as GraphRegistration<T>)
				: (registrationOrId as GraphRegistration<T>);
		const normalized = this.normalizeRegistration(registration);
		this.entries.set(normalized.id, normalized);
	}

	setEntry(entry: RegisteredGraph): void {
		this.assertMutable("set entry");
		this.entries.set(entry.id, {
			...entry,
			config: {
				...entry.config,
				stepOrder: [...entry.config.stepOrder],
				stepDefaults: entry.config.stepDefaults
					? { ...entry.config.stepDefaults }
					: undefined,
			},
			metadata: { ...entry.metadata },
		});
	}

	createGraph<T extends keyof GraphTypeRegistry>(
		graphType: T,
		services: GraphTypeRegistry[T]["services"],
		config?: GraphInstanceConfig<T>,
		context?: GraphFactoryContext,
	): GraphTypeRegistry[T]["graph"] {
		const entry = this.entries.get(graphType as string);
		if (!entry) {
			throw new Error(`No graph registered for type: ${String(graphType)}`);
		}
		return entry.factory(
			services as AllServices,
			config,
			context,
		) as GraphTypeRegistry[T]["graph"];
	}

	createChatGraph(
		graphType: string,
		services: AllServices,
		config: UnifiedFlowConfig,
		context?: GraphFactoryContext,
	): ChatGraphResult {
		const entry = this.entries.get(graphType);
		const chatFactory = entry?.config.chat;
		if (!entry || !chatFactory) {
			throw new Error(
				`[GraphRegistry] Graph "${graphType}" is not registered as chat-capable.`,
			);
		}
		return chatFactory(services, config, context);
	}

	getStepOrder(graphType: string): readonly StepSlot[] {
		return this.entries.get(graphType)?.config.stepOrder ?? [];
	}

	getStepDefaults(
		graphType: string,
		stepName: string,
	): Record<string, unknown> {
		return this.entries.get(graphType)?.config.stepDefaults?.[stepName] ?? {};
	}

	get(id: string): RegisteredGraph | undefined {
		return this.entries.get(id);
	}

	getAll(): RegisteredGraph[] {
		return Array.from(this.entries.values());
	}

	getRegisteredGraphs(): string[] {
		return Array.from(this.entries.keys());
	}

	getChatCapableGraphs(): string[] {
		return this.getAll()
			.filter((entry) => Boolean(entry.config.chat))
			.map((entry) => entry.id);
	}

	has(id: string): boolean {
		return this.entries.has(id);
	}

	hasGraph(graphType: string): boolean {
		return this.has(graphType);
	}

	hasChatGraph(graphType: string): boolean {
		return Boolean(this.entries.get(graphType)?.config.chat);
	}

	clear(): void {
		this.assertMutable("clear registry");
		this.entries.clear();
	}

	fork(predicate?: GraphRegistryPredicate): GraphRegistryManager {
		const next = new GraphRegistryManager();
		for (const entry of this.getAll()) {
			if (!predicate || predicate(entry)) {
				next.setEntry(entry);
			}
		}
		return next;
	}

	private normalizeRegistration<T extends keyof GraphTypeRegistry>(
		registration: GraphRegistration<T>,
	): RegisteredGraph {
		return {
			id: registration.id as string,
			name: registration.name ?? (registration.id as string),
			factory: registration.factory as (
				services: AllServices,
				config?: unknown,
				context?: GraphFactoryContext,
			) => BaseGraph,
			config: registration.config,
			metadata: registration.metadata ?? {},
		};
	}
}

export const graphRegistry = GraphRegistryManager.getInstance();
