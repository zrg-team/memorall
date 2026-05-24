import { logInfo, logError, logWarn } from "../../interfaces/logger";

import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";

const STEP_NAME = "entities-facts-to-context" as const;

const stableHash = (value: string): string => {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash << 5) - hash + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
};

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface EntitiesFactsToContextInput {
	// Knowledge Retrieval
	relevantNodes: Array<{
		id: string;
		nodeType: string;
		name: string;
		summary: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;

	relevantEdges: Array<{
		id: string;
		sourceId: string;
		destinationId: string;
		edgeType: string;
		factText: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;
	graphId?: string;
}

export interface EntitiesFactsToContextOutput {
	next?: string;
	knowledgeContext?: string;
	errors?: string[];
}

export type EntitiesFactsToContextServices = {};
export type EntitiesFactsToContextConfig = {};

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	EntitiesFactsToContextInput,
	EntitiesFactsToContextOutput,
	EntitiesFactsToContextServices,
	EntitiesFactsToContextConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			logInfo(
				"[FOUNDATION] Building knowledge context in natural language format",
			);

			// DEBUG: Log what we received in state
			logInfo("[FOUNDATION] State received in buildContextNode:", {
				relevantNodesCount: input.relevantNodes?.length ?? 0,
				relevantEdgesCount: input.relevantEdges?.length ?? 0,
				hasNodes: !!input.relevantNodes,
				hasEdges: !!input.relevantEdges,
				firstNode: input.relevantNodes?.[0]
					? {
							id: input.relevantNodes[0].id,
							name: input.relevantNodes[0].name,
						}
					: null,
				firstEdge: input.relevantEdges?.[0]
					? {
							id: input.relevantEdges[0].id,
							sourceId: input.relevantEdges[0].sourceId,
							destinationId: input.relevantEdges[0].destinationId,
						}
					: null,
			});

			if (!input.relevantNodes?.length || !input.relevantEdges?.length) {
				logWarn(
					"[FOUNDATION] No nodes or edges in state, returning empty context",
					{
						hasNodes: !!input.relevantNodes,
						hasEdges: !!input.relevantEdges,
						nodesLength: input.relevantNodes?.length,
						edgesLength: input.relevantEdges?.length,
					},
				);
				return {
					output: {
						knowledgeContext: "",
						next: "generate_response",
					},
				};
			}

			// 1. Build definitions section - entity names and summaries
			const definitions = input.relevantNodes
				.map(
					(node) =>
						`"${node.name}" (${node.nodeType || "Unknow"}): ${node.summary}.`,
				)
				.join("\n");

			// 2. Build facts section - entity connections with fact text
			const facts = input.relevantEdges
				.map((edge) => {
					const sourceName =
						input.relevantNodes.find((n) => n.id === edge.sourceId)?.name ||
						"Unknown";
					const destName =
						input.relevantNodes.find((n) => n.id === edge.destinationId)
							?.name || "Unknown";
					return `"${sourceName}" ${edge.edgeType} "${destName}", ${edge.factText}.`;
				})
				.join("\n");

			// 3. Build natural language context
			const knowledgeContext = `
${definitions.trim() ? `<definitions>${definitions}</definitions>` : ""}
${facts.trim() ? `<facts>${facts}</facts>` : ""}`;

			// DEBUG: Log the action metadata before returning
			const actionMetadata = {
				nodes: input.relevantNodes,
				edges: input.relevantEdges,
			};

			const nodeIds = input.relevantNodes
				.map((node) => node.id)
				.sort()
				.join("|");
			const edgeIds = input.relevantEdges
				.map((edge) => edge.id)
				.sort()
				.join("|");
			const contextHash = stableHash(knowledgeContext);
			const retrievalHash = stableHash(`${nodeIds}::${edgeIds}`);

			const actions = [
				{
					id: `knowledge_graph_${retrievalHash}`,
					name: "knowledge_graph",
					description: `Retrieved ${input.relevantNodes.length} nodes and ${input.relevantEdges.length} edges`,
					metadata: actionMetadata,
				},
				{
					id: `context_knowledge_${contextHash}`,
					name: "context_knowledge",
					description: knowledgeContext,
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					knowledgeContext,
					next: "generate_response",
				},
			};
		} catch (error) {
			logError("[FOUNDATION] Context building failed:", error);
			throw error;
		}
	},
});

type EntitiesFactsToContextSpec = StepSpecFromDefinition<typeof definition>;

export const createEntitiesFactsToContextStep: StepFactoryFromSpec<
	EntitiesFactsToContextSpec
> = (
	services: EntitiesFactsToContextServices,
	config?: EntitiesFactsToContextConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createEntitiesFactsToContextStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: EntitiesFactsToContextSpec;
	}
}
