import { END, START, StateGraph } from "@langchain/langgraph";
import {
	DEFAULT_FOUNDATION_SYSTEM_PROMPT,
	FoundationAnnotation,
	type FoundationState,
} from "@/services/flows-legacy/graph/foundation/state";
import {
	GraphBase,
	normalizeChatMessages,
} from "@/services/flows-legacy/graph/graph.base";
import type {} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { logInfo } from "@/services/flows-legacy/utils/logger";
import {
	graphRegistry,
	FEATURE_SLOT,
} from "@/services/flows-legacy/registries/graph-registry";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import type { FlowRegistrySet } from "@/services/flows-legacy/registries/registry-set";

/**
 * Foundation Flow
 *
 * A config-driven graph that chains whatever steps are enabled in
 * UnifiedFlowConfig.steps in order.  The constructor has zero knowledge of
 * specific step names — retrieval, features, completion, and citations are
 * all just entries in the steps array.
 *
 * Topology: START → step__<id1> → step__<id2> → … → END
 */
export class FoundationFlow extends GraphBase<
	string,
	FoundationState,
	AllServices
> {
	constructor(
		services: AllServices,
		config: UnifiedFlowConfig,
		registries?: FlowRegistrySet,
	) {
		super(services, registries);

		const mergedAnnotation = GraphBase.buildMergedAnnotation(
			FoundationAnnotation as Record<string, unknown>,
			config,
			this.registries,
		);
		this.workflow = new StateGraph(mergedAnnotation);

		const nodeNames = this.addStepNodes(this.workflow, config, services);

		if (nodeNames.length === 0) {
			throw new Error(
				"[FoundationFlow] No enabled steps in config — cannot build graph",
			);
		}

		// Linear chain: START → node[0] → node[1] → … → END
		this.chainNodes(this.workflow, [START, ...nodeNames, END]);

		this.compile();

		logInfo(
			`[FOUNDATION] Initialized with ${nodeNames.length} step(s): [${config.steps
				.filter((s) => s.enabled)
				.map((s) => s.name)
				.join(", ")}]`,
		);
	}
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------

graphRegistry.register(
	"foundation",
	(services, config, context) =>
		new FoundationFlow(
			services,
			config as UnifiedFlowConfig,
			context?.registries,
		),
	{
		stepDefaults: {
			"add-system": { content: DEFAULT_FOUNDATION_SYSTEM_PROMPT },
		},
		stepOrder: [
			"add-system",
			"context-smart-retrieve",
			"context-quick-retrieve",
			"context-llm-retrieve",
			"structmem-retrieve",
			FEATURE_SLOT,
			"agent-completion",
			"chat-completion",
			"entities-facts-citation",
		],
		chat: (services, config, context) => {
			const graph = new FoundationFlow(services, config, context?.registries);
			return {
				graph,
				getInitialState: (ctx) => ({
					messages: normalizeChatMessages(ctx.messages),
					graphId: ctx.topicId,
					contextQueries: ctx.contextQueries,
					tools: [],
				}),
			};
		},
	},
	{ description: "Config-driven foundation chat graph." },
);

// Extend global GraphTypeRegistry for type-safe graph creation
declare global {
	interface GraphTypeRegistry {
		foundation: {
			services: AllServices;
			config: UnifiedFlowConfig;
			graph: FoundationFlow;
		};
	}
}
