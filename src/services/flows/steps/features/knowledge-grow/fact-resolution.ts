import { logInfo, logError, logWarn } from "../../../interfaces/logger";
import { mapRefine } from "../../../utils/map-refine";

import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import type { AllServices } from "../../../interfaces/tool";
import { UuidMapper } from "../../../utils/uuid-mapping";

const STEP_NAME = "fact-resolution" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ResolvedEntity {
	uuid: string;
	name: string;
	summary?: string | null;
	nodeType: string;
	finalName: string;
	isExisting: boolean;
	existingId?: string;
}

export interface ExtractedFact {
	uuid: string;
	sourceEntityId: string;
	destinationEntityId: string;
	relationType: string;
	factText: string;
	attributes?: Record<string, unknown>;
}

export interface ResolvedFact extends ExtractedFact {
	isExisting: boolean;
	existingId?: string;
}

export interface ExistingNode {
	id: string;
	name: string;
	nodeType: string;
	summary?: string | null;
}

export interface ExistingEdge {
	id: string;
	sourceId: string;
	destinationId: string;
	edgeType: string;
	factText?: string | null;
}

export interface FactResolutionInput {
	currentMessage: string;
	previousMessages?: string;
	extractedFacts: ExtractedFact[];
	resolvedEntities: ResolvedEntity[];
	existingNodes?: ExistingNode[];
	existingEdges?: ExistingEdge[];
}

export interface FactResolutionOutput {
	resolvedFacts?: ResolvedFact[];
	processingStage?: string;
	errors?: string[];
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const FACT_RESOLUTION_SYSTEM_PROMPT = `Given the context, determine for EACH NEW EDGE whether it represents any of the edges in the list of Existing Edges.

Task:
For each new edge, determine:
1. If the New Edge represents the same factual information as any edge in Existing Edges, set 'is_duplicate: true'. Otherwise, set 'is_duplicate: false'
2. If is_duplicate is true, also return the uuid of the existing edge

Guidelines:
1. The facts do not need to be completely identical to be duplicates, they just need to express the same information
2. Process all edges in the provided list
3. Return results in the same order as the input edges

Return your response as a valid JSON array with objects matching this structure:
[
  {
    "is_duplicate": boolean,
    "existing_id": "uuid or null"
  },
  ...
]`;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	FactResolutionInput,
	FactResolutionOutput,
	AllServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			if (!input.extractedFacts || input.extractedFacts.length === 0) {
				logWarn("[FACT_RESOLUTION] No extracted facts to resolve");
				const actions = [
					{
						id: crypto.randomUUID(),
						name: "Fact Resolution Skipped",
						description: "No facts to resolve",
						metadata: { totalFacts: 0 },
					},
				];
				runConfig?.writer?.({ type: "actions", actions });

				return {
					output: {
						resolvedFacts: [],
						processingStage: "temporal_extraction",
					},
				};
			}

			// Build node name lookup and resolve entity IDs to actual node IDs
			const nodeNameById = new Map<string, string>();
			const nodeIdByEntityId = new Map<string, string>();

			for (const n of input.existingNodes || []) {
				nodeNameById.set(n.id, n.name);
			}

			// Map entity UUIDs to actual node IDs
			for (const entity of input.resolvedEntities || []) {
				if (entity.isExisting && entity.existingId) {
					nodeIdByEntityId.set(entity.uuid, entity.existingId);
				}
			}

			// Filter facts that have valid entity references
			const validFacts = input.extractedFacts.filter((fact) => {
				const sourceEntity = input.resolvedEntities?.find(
					(e) => e.uuid === fact.sourceEntityId,
				);
				const destEntity = input.resolvedEntities?.find(
					(e) => e.uuid === fact.destinationEntityId,
				);

				if (!sourceEntity || !destEntity) {
					logError(
						`[FACT_RESOLUTION] Could not find entities for fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
					);
					return false;
				}
				return true;
			});

			// Step 1: Manual resolution - check for duplicate edges
			const manuallyResolved: ResolvedFact[] = [];
			const needsAIResolution: ExtractedFact[] = [];

			// Build a map of existing edges for quick lookup
			const existingEdgeMap = new Map<string, ExistingEdge>();
			for (const edge of input.existingEdges || []) {
				const key = `${edge.sourceId}|${edge.destinationId}|${edge.edgeType}`;
				existingEdgeMap.set(key, edge);

				const reverseKey = `${edge.destinationId}|${edge.sourceId}|${edge.edgeType}`;
				if (!existingEdgeMap.has(reverseKey)) {
					existingEdgeMap.set(reverseKey, edge);
				}
			}

			for (const fact of validFacts) {
				const sourceNodeId = nodeIdByEntityId.get(fact.sourceEntityId);
				const destNodeId = nodeIdByEntityId.get(fact.destinationEntityId);

				if (sourceNodeId && destNodeId) {
					const edgeKey = `${sourceNodeId}|${destNodeId}|${fact.relationType}`;
					const existingEdge = existingEdgeMap.get(edgeKey);

					if (existingEdge) {
						manuallyResolved.push({
							...fact,
							isExisting: true,
							existingId: existingEdge.id,
						});
						logInfo(
							`[FACT_RESOLUTION] Manual duplicate detected: ${sourceNodeId} -[${fact.relationType}]-> ${destNodeId} (edge ${existingEdge.id})`,
						);
						continue;
					}
				}

				needsAIResolution.push(fact);
			}

			logInfo(
				`[FACT_RESOLUTION] Manual resolution: ${manuallyResolved.length} duplicates found, ${needsAIResolution.length} need AI`,
			);

			// If all facts were manually resolved, return early
			if (needsAIResolution.length === 0) {
				const invalidFacts = input.extractedFacts
					.filter((fact) => {
						const sourceEntity = input.resolvedEntities?.find(
							(e) => e.uuid === fact.sourceEntityId,
						);
						const destEntity = input.resolvedEntities?.find(
							(e) => e.uuid === fact.destinationEntityId,
						);
						return !sourceEntity || !destEntity;
					})
					.map((fact) => ({
						...fact,
						isExisting: false,
					}));

				const allResolvedFacts = [...manuallyResolved, ...invalidFacts];

				const actions = [
					{
						id: crypto.randomUUID(),
						name: "Fact Resolution Complete (Manual Only)",
						description: `Resolved ${allResolvedFacts.length} facts via manual duplicate detection`,
						metadata: {
							totalFacts: allResolvedFacts.length,
							manualDuplicates: manuallyResolved.length,
							aiResolved: 0,
							invalidFacts: invalidFacts.length,
						},
					},
				];
				runConfig?.writer?.({ type: "actions", actions });

				return {
					output: {
						resolvedFacts: allResolvedFacts,
						processingStage: "temporal_extraction",
					},
				};
			}

			// Step 2: AI resolution for remaining facts
			const llm = services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Prepare existing edges text
			const existingEdgesText = (input.existingEdges || [])
				.map((edge) => {
					const sourceName = nodeNameById.get(edge.sourceId) || "Unknown";
					const destName = nodeNameById.get(edge.destinationId) || "Unknown";
					return `ID: ${edge.id}, Source: ${sourceName}, Destination: ${destName}, Type: ${edge.edgeType}, Fact: ${edge.factText || ""}`;
				})
				.join("\n");

			// Prepare facts text for processing
			const factsText = needsAIResolution
				.map((fact, index) => {
					const sourceEntity = input.resolvedEntities?.find(
						(e) => e.uuid === fact.sourceEntityId,
					);
					const destEntity = input.resolvedEntities?.find(
						(e) => e.uuid === fact.destinationEntityId,
					);
					return `${index + 1}. Source: ${sourceEntity?.finalName || "Unknown"}, Destination: ${destEntity?.finalName || "Unknown"}, Type: ${fact.relationType}, Fact: ${fact.factText}`;
				})
				.join("\n");

			const fullText = `<EXISTING EDGES>
${existingEdgesText || "No existing edges"}
</EXISTING EDGES>
<NEW EDGES>
${factsText}
</NEW EDGES>`;

			interface ParsedFactResolution {
				is_duplicate?: boolean;
				existing_id?: string;
			}

			// Create UUID mapper for this resolution session
			const uuidMapper = new UuidMapper();

			const parseFactResolutions = (content: string): ResolvedFact[] => {
				let cleaned = content.trim();
				if (cleaned.startsWith("```json"))
					cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
				else if (cleaned.startsWith("```"))
					cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/i, "");

				try {
					const parsedArray = JSON.parse(cleaned) as ParsedFactResolution[];

					if (!Array.isArray(parsedArray)) {
						throw new Error("Response is not an array");
					}

					const results: ResolvedFact[] = [];
					for (
						let i = 0;
						i < Math.min(parsedArray.length, needsAIResolution.length);
						i++
					) {
						const fact = needsAIResolution[i];
						const resolution = parsedArray[i] || {
							is_duplicate: false,
						};

						const isDuplicate = resolution.is_duplicate || false;

						const mappingResult = uuidMapper.mapFactUuid(
							fact.sourceEntityId,
							fact.destinationEntityId,
							fact.relationType,
							resolution.existing_id,
							input.existingEdges || [],
							input.resolvedEntities || [],
						);

						if (isDuplicate && !mappingResult.isExisting) {
							logInfo(
								`[FACT_RESOLUTION] LLM marked fact "${fact.relationType}" as duplicate but could not find matching edge. Created new fact with UUID: ${mappingResult.correctUuid}`,
							);
						}

						results.push({
							...fact,
							uuid: mappingResult.correctUuid,
							isExisting: mappingResult.isExisting,
							existingId: mappingResult.isExisting
								? mappingResult.correctUuid
								: undefined,
						});
					}

					// Handle any remaining facts that weren't in the response
					for (let i = parsedArray.length; i < needsAIResolution.length; i++) {
						const fact = needsAIResolution[i];
						const mappingResult = uuidMapper.mapFactUuid(
							fact.sourceEntityId,
							fact.destinationEntityId,
							fact.relationType,
							undefined,
							input.existingEdges || [],
							input.resolvedEntities || [],
						);

						results.push({
							...fact,
							uuid: mappingResult.correctUuid,
							isExisting: false,
						});
					}

					return results;
				} catch (parseError) {
					logError(
						"[FACT_RESOLUTION] JSON parsing failed, using fallback:",
						parseError,
					);

					return needsAIResolution.map((fact) => {
						const mappingResult = uuidMapper.mapFactUuid(
							fact.sourceEntityId,
							fact.destinationEntityId,
							fact.relationType,
							undefined,
							input.existingEdges || [],
							input.resolvedEntities || [],
						);

						return {
							...fact,
							uuid: mappingResult.correctUuid,
							isExisting: false,
						};
					});
				}
			};

			const maxModelTokens = await services.llm.getMaxModelTokens();
			const maxResponseTokens = await services.llm.getMaxResponseTokens();

			const aiResolvedFacts = await mapRefine<ResolvedFact>(
				llm,
				FACT_RESOLUTION_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
					const prevSummary =
						prev.length > 0
							? prev
									.map(
										(p, idx) =>
											`${idx + 1}. ${p.relationType} (${p.isExisting ? "existing" : "new"})`,
									)
									.join(", ")
							: "No previous results";
					let prompt = `<PREVIOUS RESULTS>\n${prevSummary}\n</PREVIOUS RESULTS>\n\n<CHUNK>\n${chunk}\n</CHUNK>`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and ensure all fact resolutions are properly structured.\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseFactResolutions,
				fullText,
				{
					maxModelTokens,
					maxResponseTokens,
					temperature: 0.0,
					maxRetries: 2,
					dedupeBy: (f) =>
						`${f.sourceEntityId}|${f.destinationEntityId}|${f.relationType}`,
					onError: (error, attempt) => {
						logError(
							`[FACT_RESOLUTION] Parse error on attempt ${attempt}:`,
							error,
						);
						if (
							error.message.includes("JSON") ||
							error.message.includes("parse")
						) {
							return `JSON parsing failed: ${error.message}. Please ensure the response is a valid JSON array with is_duplicate and existing_id fields.`;
						}
						return `Fact resolution failed on attempt ${attempt}: ${error.message}. Please retry with correct JSON format.`;
					},
				},
			);

			// Add back any invalid facts as not duplicates
			const invalidFacts = input.extractedFacts
				.filter((fact) => {
					const sourceEntity = input.resolvedEntities?.find(
						(e) => e.uuid === fact.sourceEntityId,
					);
					const destEntity = input.resolvedEntities?.find(
						(e) => e.uuid === fact.destinationEntityId,
					);
					return !sourceEntity || !destEntity;
				})
				.map((fact) => ({
					...fact,
					isExisting: false,
				}));

			const allResolvedFacts = [
				...manuallyResolved,
				...aiResolvedFacts,
				...invalidFacts,
			];

			logInfo(
				`[FACT_RESOLUTION] Resolved ${allResolvedFacts.length} facts (${manuallyResolved.length} manual, ${aiResolvedFacts.length} AI, ${invalidFacts.length} invalid)`,
			);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Fact Resolution Complete",
					description: `Resolved ${allResolvedFacts.length} facts. ${allResolvedFacts.filter((f) => f.isExisting).length} existing, ${allResolvedFacts.filter((f) => !f.isExisting).length} new (${manuallyResolved.length} manual, ${aiResolvedFacts.length} AI, ${invalidFacts.length} invalid)`,
					metadata: {
						totalFacts: allResolvedFacts.length,
						existingFacts: allResolvedFacts.filter((f) => f.isExisting).length,
						newFacts: allResolvedFacts.filter((f) => !f.isExisting).length,
						manualDuplicates: manuallyResolved.length,
						aiResolved: aiResolvedFacts.length,
						invalidFacts: invalidFacts.length,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					resolvedFacts: allResolvedFacts,
					processingStage: "temporal_extraction",
				},
			};
		} catch (error) {
			logError("[FACT_RESOLUTION] Error:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Fact Resolution Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error ? error.message : "Fact resolution failed",
					],
				},
			};
		}
	},
});

type FactResolutionSpec = StepSpecFromDefinition<typeof definition>;

export const createFactResolutionStep: StepFactoryFromSpec<
	FactResolutionSpec
> = (services: AllServices) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createFactResolutionStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: FactResolutionSpec;
	}
}
