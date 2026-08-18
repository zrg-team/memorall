import { END, START, StateGraph } from "@langchain/langgraph";
import { logInfo } from "@memorall/agent-harness-flows/logging/logger";

import { StructMemAnnotation, type StructMemState } from "./state";
import { GraphBase } from "@memorall/agent-harness-flows/graph/graph.base";
import type {} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { graphRegistry } from "@memorall/agent-harness-flows/registries/graph-registry";
import type { FlowRegistrySet } from "@memorall/agent-harness-flows/registries/registry-set";

export interface StructMemGraphConfig {
	consolidationWindowMs?: number;
	semanticSeedLimit?: number;
	qaEntryLimit?: number;
	qaSynthesisLimit?: number;
	enableConsolidation?: boolean;
}

export const DEFAULT_STRUCTMEM_CONFIG: Required<StructMemGraphConfig> = {
	consolidationWindowMs: 60 * 60 * 1000,
	semanticSeedLimit: 15,
	qaEntryLimit: 60,
	qaSynthesisLimit: 5,
	enableConsolidation: true,
};

export class StructMemGraphFlow extends GraphBase<
	| "extract_event"
	| "save_event_entries"
	| "load_related_events"
	| "consolidate_events"
	| "save_consolidation",
	StructMemState,
	AllServices
> {
	private config: Required<StructMemGraphConfig>;

	constructor(
		services: AllServices,
		config: StructMemGraphConfig = {},
		registries?: FlowRegistrySet,
	) {
		super(services, registries);
		this.config = {
			...DEFAULT_STRUCTMEM_CONFIG,
			...config,
		};

		this.workflow = new StateGraph(StructMemAnnotation);

		const eventExtractionStep = this.registries.steps.getStep(
			"structmem-event-extraction",
			services,
		);
		const saveEventStep = this.registries.steps.getStepByName(
			"structmem-save-event",
			services,
			this.config,
		);
		const loadRelatedEventsStep = this.registries.steps.getStepByName(
			"structmem-load-related-events",
			services,
			this.config,
		);
		const consolidationStep = this.registries.steps.getStepByName(
			"structmem-consolidation",
			services,
			this.config,
		);
		const saveConsolidationStep = this.registries.steps.getStep(
			"structmem-save-consolidation",
			services,
		);

		this.workflow.addNode("extract_event", eventExtractionStep.toNode());
		this.workflow.addNode("save_event_entries", saveEventStep.toNode());
		this.workflow.addNode(
			"load_related_events",
			loadRelatedEventsStep.toNode(),
		);
		this.workflow.addNode("consolidate_events", consolidationStep.toNode());
		this.workflow.addNode("save_consolidation", saveConsolidationStep.toNode());

		this.workflow.addEdge(START, "extract_event");
		this.workflow.addEdge("extract_event", "save_event_entries");
		this.workflow.addConditionalEdges("save_event_entries", (state) => {
			if (!this.config.enableConsolidation) {
				logInfo("[STRUCTMEM] Consolidation disabled, ending after event save");
				return END;
			}
			if (!state.bufferedEntries?.length || !state.shouldConsolidate) {
				logInfo("[STRUCTMEM] Consolidation window not reached");
				return END;
			}
			return "load_related_events";
		});
		this.workflow.addEdge("load_related_events", "consolidate_events");
		this.workflow.addConditionalEdges("consolidate_events", (state) => {
			if (!state.consolidatedSummaries?.length) {
				logInfo("[STRUCTMEM] No grounded summaries produced");
				return END;
			}
			return "save_consolidation";
		});
		this.workflow.addEdge("save_consolidation", END);

		this.compile();
	}
}

graphRegistry.register(
	"structmem",
	(services, config, context) =>
		new StructMemGraphFlow(
			services,
			config as StructMemGraphConfig,
			context?.registries,
		),
	{
		stepOrder: [
			"structmem-event-extraction",
			"structmem-save-event",
			"structmem-load-related-events",
			"structmem-consolidation",
			"structmem-save-consolidation",
		],
	},
	{
		description: "Structured memory event extraction and consolidation graph.",
	},
);

declare global {
	interface GraphTypeRegistry {
		structmem: {
			services: AllServices;
			config: StructMemGraphConfig;
			graph: StructMemGraphFlow;
		};
	}
}
