import { END, START, StateGraph } from "@langchain/langgraph";
import { logInfo } from "../../interfaces/logger";

import { StructMemAnnotation, type StructMemState } from "./state";
import { GraphBase } from "../graph.base";
import type { AllServices } from "../../interfaces/tool";
import { flowRegistry } from "../../flow-registry";
import { stepRegistry } from "../../step-registry";

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

	constructor(services: AllServices, config: StructMemGraphConfig = {}) {
		super(services);
		this.config = {
			...DEFAULT_STRUCTMEM_CONFIG,
			...config,
		};

		this.workflow = new StateGraph(StructMemAnnotation);

		const eventExtractionStep = stepRegistry.getStep(
			"structmem-event-extraction",
			services,
		);
		const saveEventStep = stepRegistry.getStepByName(
			"structmem-save-event",
			services,
			this.config,
		);
		const loadRelatedEventsStep = stepRegistry.getStepByName(
			"structmem-load-related-events",
			services,
			this.config,
		);
		const consolidationStep = stepRegistry.getStepByName(
			"structmem-consolidation",
			services,
			this.config,
		);
		const saveConsolidationStep = stepRegistry.getStep(
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

flowRegistry.register({
	flowType: "structmem",
	stepOrder: [
		"structmem-event-extraction",
		"structmem-save-event",
		"structmem-load-related-events",
		"structmem-consolidation",
		"structmem-save-consolidation",
	],
	factory: (services, config) =>
		new StructMemGraphFlow(services, config as StructMemGraphConfig),
});

declare global {
	interface FlowTypeRegistry {
		structmem: {
			services: AllServices;
			config: StructMemGraphConfig;
			flow: StructMemGraphFlow;
		};
	}
}
