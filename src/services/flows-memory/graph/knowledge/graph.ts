import { END, START, StateGraph } from "@langchain/langgraph";
import { logInfo } from "@/services/flows-legacy/utils/logger";

import { KnowledgeGraphAnnotation, type KnowledgeGraphState } from "./state";
import { GraphBase } from "@/services/flows-legacy/graph/graph.base";
import type {} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { graphRegistry } from "@/services/flows-legacy/registries/graph-registry";
import type { FlowRegistrySet } from "@/services/flows-legacy/registries/registry-set";

export interface KnowledgeGraphConfig {
	enableTemporalExtraction?: boolean;
	disableFactExtractionV2?: boolean;
}

export class KnowledgeGraphFlow extends GraphBase<
	| "load_entities"
	| "extract_entities"
	| "resolve_entities"
	| "extract_facts"
	| "load_facts"
	| "resolve_facts"
	| "enrich_edges"
	| "extract_temporal"
	| "save_to_database",
	KnowledgeGraphState,
	AllServices
> {
	private config: KnowledgeGraphConfig;

	constructor(
		services: AllServices,
		config: KnowledgeGraphConfig = {},
		registries?: FlowRegistrySet,
	) {
		super(services, registries);
		this.config = {
			enableTemporalExtraction: false, // Disabled by default
			...config,
		};
		this.workflow = new StateGraph(KnowledgeGraphAnnotation);

		const entityExtractionStep = this.registries.steps.getStep(
			"entity-extraction",
			services,
		);
		const entityResolutionStep = this.registries.steps.getStep(
			"entity-resolution",
			services,
		);
		const factExtractionStep = !config.disableFactExtractionV2
			? this.registries.steps.getStep("fact-extraction-v2", services)
			: this.registries.steps.getStep("fact-extraction", services);
		const factResolutionStep = this.registries.steps.getStep(
			"fact-resolution",
			services,
		);
		const edgeEnrichmentStep = this.registries.steps.getStep(
			"edge-enrichment",
			services,
		);
		const databaseSaveStep = this.registries.steps.getStep(
			"knowledge-database-save",
			services,
		);
		const loadFactStep = this.registries.steps.getStep("load-facts", services);
		const loadEntitiesStep = this.registries.steps.getStep(
			"load-entities",
			services,
		);

		// Add nodes
		this.workflow.addNode("load_entities", loadEntitiesStep.toNode());
		this.workflow.addNode("load_facts", loadFactStep.toNode());
		this.workflow.addNode("extract_entities", entityExtractionStep.toNode());
		this.workflow.addNode("resolve_entities", entityResolutionStep.toNode());
		this.workflow.addNode("extract_facts", factExtractionStep.toNode());
		this.workflow.addNode("resolve_facts", factResolutionStep.toNode());
		this.workflow.addNode("enrich_edges", edgeEnrichmentStep.toNode());
		this.workflow.addNode("save_to_database", databaseSaveStep.toNode());

		// Conditionally add temporal extraction
		if (this.config.enableTemporalExtraction) {
			const temporalExtraction = this.registries.steps.getStep(
				"temporal-extraction",
				services,
			);
			this.workflow.addNode("extract_temporal", temporalExtraction.toNode());
		}

		// Define the flow with conditional logic
		this.workflow.addEdge(START, "extract_entities");

		// After entity extraction: conditionally skip resolution if no entities
		this.workflow.addConditionalEdges("extract_entities", (state) => {
			const hasEntities =
				state.extractedEntities && state.extractedEntities.length > 0;
			if (!hasEntities) {
				logInfo(
					"[FLOW] No entities extracted, skipping entity resolution and going to save",
				);
				return "save_to_database";
			}
			return "load_entities";
		});

		this.workflow.addEdge("load_entities", "resolve_entities");
		this.workflow.addEdge("resolve_entities", "extract_facts");

		// After fact extraction: conditionally skip resolution if no facts
		this.workflow.addConditionalEdges("extract_facts", (state) => {
			const hasFacts = state.extractedFacts && state.extractedFacts.length > 0;
			if (!hasFacts) {
				logInfo(
					"[FLOW] No facts extracted, skipping fact resolution and edge enrichment",
				);
				if (this.config.enableTemporalExtraction) {
					return "extract_temporal";
				}
				return "save_to_database";
			}
			return "load_facts";
		});

		this.workflow.addEdge("load_facts", "resolve_facts");

		// After fact resolution: conditionally run edge enrichment only if there are isolated entities
		this.workflow.addConditionalEdges("resolve_facts", (state) => {
			// Check if there are entities without any edges
			const entityIds = new Set(
				(state.resolvedEntities || []).map((e) => e.uuid),
			);
			const connectedEntityIds = new Set<string>();

			// Mark entities that have connections
			for (const fact of state.resolvedFacts || []) {
				connectedEntityIds.add(fact.sourceEntityId);
				connectedEntityIds.add(fact.destinationEntityId);
			}

			// Find isolated entities (entities without connections)
			const isolatedEntities = Array.from(entityIds).filter(
				(id) => !connectedEntityIds.has(id),
			);

			if (isolatedEntities.length > 0) {
				logInfo(
					`[FLOW] Found ${isolatedEntities.length} isolated entities, running edge enrichment`,
				);
				return "enrich_edges";
			}

			logInfo("[FLOW] No isolated entities, skipping edge enrichment");
			if (this.config.enableTemporalExtraction) {
				return "extract_temporal";
			}
			return "save_to_database";
		});

		if (this.config.enableTemporalExtraction) {
			// With temporal extraction: enrich_edges -> extract_temporal -> save_to_database
			this.workflow.addEdge("enrich_edges", "extract_temporal");
			this.workflow.addEdge("extract_temporal", "save_to_database");
		} else {
			// Without temporal extraction: enrich_edges -> save_to_database
			this.workflow.addEdge("enrich_edges", "save_to_database");
		}

		this.workflow.addEdge("save_to_database", END);

		// Compile the workflow
		this.compile();
	}
}

// Self-register the flow
graphRegistry.register(
	"knowledge",
	(services, config, context) =>
		new KnowledgeGraphFlow(services, config, context?.registries),
	{
		stepOrder: [
			"entity-extraction",
			"load-entities",
			"entity-resolution",
			"fact-extraction-v2",
			"load-facts",
			"fact-resolution",
			"edge-enrichment",
			"temporal-extraction",
			"knowledge-database-save",
		],
	},
	{ description: "Knowledge graph extraction and persistence graph." },
);

// Extend global GraphTypeRegistry for type-safe graph creation
declare global {
	interface GraphTypeRegistry {
		knowledge: {
			services: AllServices;
			config: KnowledgeGraphConfig;
			graph: KnowledgeGraphFlow;
		};
	}
}
