import { END, START, StateGraph } from "@langchain/langgraph";
import {
	DEFAULT_FOUNDATION_SYSTEM_PROMPT,
	FoundationAnnotation,
	type FoundationState,
} from "./state";
import { GraphBase } from "../graph.base";
import type { AllServices } from "../../interfaces/tool";
import { logInfo } from "../../interfaces/logger";
import { flowRegistry, FEATURE_SLOT } from "../../flow-registry";
import { chatFlowRegistry } from "../../chat-flow-registry";
import type { UnifiedFlowConfig } from "../../interfaces/flow-config";

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
	constructor(services: AllServices, config: UnifiedFlowConfig) {
		super(services);

		this.workflow = new StateGraph(FoundationAnnotation);

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

flowRegistry.register({
	flowType: "foundation",
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
	factory: (services, config) =>
		new FoundationFlow(services, config as UnifiedFlowConfig),
});

// Chat flow registry — used by process-chat.ts via chatFlowRegistry.create(…)
chatFlowRegistry.register("foundation", (services, config) => {
	const graph = new FoundationFlow(services, config);
	return {
		graph,
		getInitialState: (ctx) => ({
			messages: ctx.messages,
			graphId: ctx.topicId,
			contextQueries: ctx.contextQueries,
			// tools starts empty; feature steps accumulate into state,
			// and agent-completion merges config.tools on top at runtime.
			tools: [],
		}),
	};
});

// Extend global FlowTypeRegistry for type-safe flow creation
declare global {
	interface FlowTypeRegistry {
		foundation: {
			services: AllServices;
			config: UnifiedFlowConfig;
			flow: FoundationFlow;
		};
	}
}
