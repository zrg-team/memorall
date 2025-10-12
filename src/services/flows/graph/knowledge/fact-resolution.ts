import type { Edge } from "@/services/database";
import type { KnowledgeGraphState, ResolvedFact, ExtractedFact } from "./state";
import type { AllServices } from "@/services/flows/interfaces/tool";
import { logInfo, logError, logWarn } from "@/utils/logger";
import { mapRefine } from "@/utils/map-refine";

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

export class FactResolutionFlow {
	constructor(private services: AllServices) {}

	async resolveFacts(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			if (!state.extractedFacts || state.extractedFacts.length === 0) {
				logWarn("[FACT_RESOLUTION] No extracted facts to resolve");
				return {
					resolvedFacts: [],
					processingStage: "temporal_extraction",
					actions: [
						{
							id: crypto.randomUUID(),
							name: "Fact Resolution Skipped",
							description: "No facts to resolve",
							metadata: { totalFacts: 0 },
						},
					],
				};
			}

			// Build node name lookup and resolve entity IDs to actual node IDs
			const nodeNameById = new Map<string, string>();
			const nodeIdByEntityId = new Map<string, string>();

			for (const n of state.existingNodes || []) {
				nodeNameById.set(n.id!, n.name!);
			}

			// Map entity UUIDs to actual node IDs
			for (const entity of state.resolvedEntities || []) {
				if (entity.isExisting && entity.existingId) {
					nodeIdByEntityId.set(entity.uuid, entity.existingId);
				}
			}

			// Filter facts that have valid entity references
			const validFacts = state.extractedFacts.filter((fact) => {
				const sourceEntity = state.resolvedEntities?.find(
					(e) => e.uuid === fact.sourceEntityId,
				);
				const destEntity = state.resolvedEntities?.find(
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
			// Key format: "sourceId|destinationId|relationType"
			const existingEdgeMap = new Map<string, Edge>();
			for (const edge of state.existingEdges || []) {
				const key = `${edge.sourceId}|${edge.destinationId}|${edge.edgeType}`;
				existingEdgeMap.set(key, edge);

				// Also add reverse direction for bidirectional relationships
				const reverseKey = `${edge.destinationId}|${edge.sourceId}|${edge.edgeType}`;
				if (!existingEdgeMap.has(reverseKey)) {
					existingEdgeMap.set(reverseKey, edge);
				}
			}

			for (const fact of validFacts) {
				// Get resolved node IDs for source and destination
				const sourceNodeId = nodeIdByEntityId.get(fact.sourceEntityId);
				const destNodeId = nodeIdByEntityId.get(fact.destinationEntityId);

				// Check if both entities are resolved to existing nodes
				if (sourceNodeId && destNodeId) {
					const edgeKey = `${sourceNodeId}|${destNodeId}|${fact.relationType}`;
					const existingEdge = existingEdgeMap.get(edgeKey);

					if (existingEdge) {
						// Duplicate edge found - mark as existing
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

				// No duplicate found - needs AI resolution
				needsAIResolution.push(fact);
			}

			logInfo(
				`[FACT_RESOLUTION] Manual resolution: ${manuallyResolved.length} duplicates found, ${needsAIResolution.length} need AI`,
			);

			// If all facts were manually resolved, return early
			if (needsAIResolution.length === 0) {
				// Add back any invalid facts as not duplicates
				const invalidFacts = state.extractedFacts
					.filter((fact) => {
						const sourceEntity = state.resolvedEntities?.find(
							(e) => e.uuid === fact.sourceEntityId,
						);
						const destEntity = state.resolvedEntities?.find(
							(e) => e.uuid === fact.destinationEntityId,
						);
						return !sourceEntity || !destEntity;
					})
					.map((fact) => ({
						...fact,
						isExisting: false,
					}));

				const allResolvedFacts = [...manuallyResolved, ...invalidFacts];

				return {
					resolvedFacts: allResolvedFacts,
					processingStage: "temporal_extraction",
					actions: [
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
					],
				};
			}

			// Step 2: AI resolution for remaining facts
			const llm = this.services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Prepare existing edges text
			const existingEdgesText = (state.existingEdges || [])
				.map((edge) => {
					const sourceName = nodeNameById.get(`${edge.sourceId}`) || "Unknown";
					const destName =
						nodeNameById.get(`${edge.destinationId}`) || "Unknown";
					return `ID: ${edge.id}, Source: ${sourceName}, Destination: ${destName}, Type: ${edge.edgeType}, Fact: ${edge.factText}`;
				})
				.join("\n");

			// Prepare facts text for processing (only facts needing AI resolution)
			const factsText = needsAIResolution
				.map((fact, index) => {
					const sourceEntity = state.resolvedEntities?.find(
						(e) => e.uuid === fact.sourceEntityId,
					);
					const destEntity = state.resolvedEntities?.find(
						(e) => e.uuid === fact.destinationEntityId,
					);
					return `${index + 1}. Source: ${sourceEntity?.finalName || "Unknown"}, Destination: ${destEntity?.finalName || "Unknown"}, Type: ${fact.relationType}, Fact: ${fact.factText}`;
				})
				.join("\n");

			// Combine all content for processing
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

					// Map parsed resolutions to resolved facts (only for AI-resolved facts)
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

						results.push({
							...fact,
							isExisting: resolution.is_duplicate || false,
							existingId: resolution.existing_id,
						});
					}

					// Handle any remaining facts that weren't in the response
					for (let i = parsedArray.length; i < needsAIResolution.length; i++) {
						const fact = needsAIResolution[i];
						results.push({
							...fact,
							isExisting: false,
						});
					}

					return results;
				} catch (parseError) {
					logError(
						"[FACT_RESOLUTION] JSON parsing failed, using fallback:",
						parseError,
					);

					// Fallback: assume all AI-resolution facts are new
					return needsAIResolution.map((fact) => ({
						...fact,
						isExisting: false,
					}));
				}
			};

			const maxModelTokens = await this.services.llm.getMaxModelTokens();

			const aiResolvedFacts = await mapRefine<ResolvedFact>(
				llm,
				FACT_RESOLUTION_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
					// Include previous results summary to maintain context
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
					maxResponseTokens: 6144,
					temperature: 0.0,
					maxRetries: 2,
					dedupeBy: (f) =>
						`${f.sourceEntityId}|${f.destinationEntityId}|${f.relationType}`,
					onError: (error, attempt, chunk) => {
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
			const invalidFacts = state.extractedFacts
				.filter((fact) => {
					const sourceEntity = state.resolvedEntities?.find(
						(e) => e.uuid === fact.sourceEntityId,
					);
					const destEntity = state.resolvedEntities?.find(
						(e) => e.uuid === fact.destinationEntityId,
					);
					return !sourceEntity || !destEntity;
				})
				.map((fact) => ({
					...fact,
					isExisting: false,
				}));

			// Combine manual, AI-resolved, and invalid facts
			const allResolvedFacts = [
				...manuallyResolved,
				...aiResolvedFacts,
				...invalidFacts,
			];

			logInfo(
				`[FACT_RESOLUTION] Resolved ${allResolvedFacts.length} facts (${manuallyResolved.length} manual, ${aiResolvedFacts.length} AI, ${invalidFacts.length} invalid)`,
			);

			return {
				resolvedFacts: allResolvedFacts,
				processingStage: "temporal_extraction",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Fact Resolution Complete",
						description: `Resolved ${allResolvedFacts.length} facts. ${allResolvedFacts.filter((f) => f.isExisting).length} existing, ${allResolvedFacts.filter((f) => !f.isExisting).length} new (${manuallyResolved.length} manual, ${aiResolvedFacts.length} AI, ${invalidFacts.length} invalid)`,
						metadata: {
							totalFacts: allResolvedFacts.length,
							existingFacts: allResolvedFacts.filter((f) => f.isExisting)
								.length,
							newFacts: allResolvedFacts.filter((f) => !f.isExisting).length,
							manualDuplicates: manuallyResolved.length,
							aiResolved: aiResolvedFacts.length,
							invalidFacts: invalidFacts.length,
						},
					},
				],
			};
		} catch (error) {
			logError("[FACT_RESOLUTION] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Fact resolution failed",
				],
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Fact Resolution Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}
}
