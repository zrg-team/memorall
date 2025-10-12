import type { KnowledgeGraphState, ExtractedFact } from "./state";
import type { AllServices } from "@/services/flows/interfaces/tool";
import { logInfo, logError } from "@/utils/logger";
import { mapRefine } from "@/utils/map-refine";

const EDGE_ENRICHMENT_SYSTEM_PROMPT = `You are tasked with finding missing relationships between entities in a knowledge graph.

Given a list of ISOLATED NODES (nodes with no connections) and ALL OTHER NODES, identify meaningful relationships between the isolated nodes and any other nodes.

Task:
For each isolated node, identify all relevant relationships to other nodes based on the CONTENT provided.

Guidelines:
1. Only create relationships that are explicitly supported by the content
2. Focus on creating high-quality, meaningful connections
3. Consider various relationship types: related_to, part_of, located_in, works_at, knows, etc.
4. Each relationship must have a clear factual basis from the content
5. Avoid creating speculative or inferred relationships without evidence
6. Return as many relevant relationships as you can find for each isolated node
7. It's okay if some isolated nodes remain without relationships if none are evident

Return your response as a valid JSON array with objects matching this structure:
[
  {
    "source_entity_name": "Name of source node",
    "destination_entity_name": "Name of destination node",
    "relation_type": "Type of relationship",
    "fact_text": "Brief description of the relationship with supporting evidence from content"
  },
  ...
]`;

export class EdgeEnrichmentFlow {
	constructor(private services: AllServices) {}

	async enrichEdges(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			logInfo("[EDGE_ENRICHMENT] Starting edge enrichment for isolated nodes");

			// Find isolated nodes (nodes with no edges)
			const nodeIdWithEdges = new Set<string>();
			for (const edge of state.existingEdges || []) {
				nodeIdWithEdges.add(edge.sourceId);
				nodeIdWithEdges.add(edge.destinationId);
			}

			// Also include edges from resolved facts
			for (const fact of state.resolvedFacts || []) {
				const sourceEntity = state.resolvedEntities?.find(
					(e) => e.uuid === fact.sourceEntityId,
				);
				const destEntity = state.resolvedEntities?.find(
					(e) => e.uuid === fact.destinationEntityId,
				);

				if (sourceEntity?.existingId) {
					nodeIdWithEdges.add(sourceEntity.existingId);
				}
				if (destEntity?.existingId) {
					nodeIdWithEdges.add(destEntity.existingId);
				}
			}

			// Create list of all nodes (existing + newly resolved)
			const allNodes = new Map<string, { id?: string; name: string }>();

			for (const node of state.existingNodes || []) {
				if (node.id) {
					allNodes.set(node.id, { id: node.id, name: node.name });
				}
			}

			for (const entity of state.resolvedEntities || []) {
				if (entity.existingId) {
					allNodes.set(entity.existingId, {
						id: entity.existingId,
						name: entity.finalName,
					});
				} else {
					// For new nodes, use UUID as temporary ID
					allNodes.set(entity.uuid, { id: entity.uuid, name: entity.finalName });
				}
			}

			// Find isolated nodes
			const isolatedNodes: Array<{ id: string; name: string }> = [];
			for (const [nodeId, nodeData] of allNodes.entries()) {
				if (!nodeIdWithEdges.has(nodeId)) {
					isolatedNodes.push({ id: nodeId, name: nodeData.name });
				}
			}

			if (isolatedNodes.length === 0) {
				logInfo("[EDGE_ENRICHMENT] No isolated nodes found");
				return {
					processingStage: "temporal_extraction",
					actions: [
						{
							id: crypto.randomUUID(),
							name: "Edge Enrichment Skipped",
							description: "No isolated nodes to enrich",
							metadata: { isolatedNodes: 0 },
						},
					],
				};
			}

			logInfo(
				`[EDGE_ENRICHMENT] Found ${isolatedNodes.length} isolated nodes out of ${allNodes.size} total nodes`,
			);

			const llm = this.services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Format content with proper context
			let contentSection = `<CONTENT>\n${state.currentMessage}\n</CONTENT>`;

			// Add context if available
			if (state.previousMessages && state.previousMessages.trim().length > 0) {
				contentSection = `<CONTEXT>\n${state.previousMessages}\n</CONTEXT>\n\n${contentSection}`;
			}

			// Add metadata for better understanding
			if (state.url || state.title) {
				const metadata = [];
				if (state.title) metadata.push(`Title: ${state.title}`);
				if (state.url) metadata.push(`Source: ${state.url}`);
				contentSection = `<METADATA>\n${metadata.join("\n")}\n</METADATA>\n\n${contentSection}`;
			}

			// Prepare isolated nodes text
			const isolatedNodesText = isolatedNodes
				.map(
					(node, index) => `${index + 1}. ID: ${node.id}, Name: ${node.name}`,
				)
				.join("\n");

			// Prepare all nodes text (for relationship targets)
			const connectedNodes = Array.from(allNodes.values()).filter((node) =>
				nodeIdWithEdges.has(node.id || ""),
			);
			const allNodesText = connectedNodes
				.map((node, index) => `${index + 1}. ID: ${node.id}, Name: ${node.name}`)
				.join("\n");

			// Combine all content for processing
			const fullText = `${contentSection}

<ISOLATED NODES>
${isolatedNodesText}
</ISOLATED NODES>

<ALL OTHER NODES>
${allNodesText || "No connected nodes"}
</ALL OTHER NODES>`;

			interface ParsedRelationship {
				source_entity_name?: string;
				destination_entity_name?: string;
				relation_type?: string;
				fact_text?: string;
			}

			const parseRelationships = (content: string): ExtractedFact[] => {
				let cleaned = content.trim();
				if (cleaned.startsWith("```json"))
					cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
				else if (cleaned.startsWith("```"))
					cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/i, "");

				try {
					const parsedArray = JSON.parse(cleaned) as ParsedRelationship[];

					if (!Array.isArray(parsedArray)) {
						throw new Error("Response is not an array");
					}

					// Map parsed relationships to extracted facts
					const results: ExtractedFact[] = [];
					for (const rel of parsedArray) {
						if (
							!rel.source_entity_name ||
							!rel.destination_entity_name ||
							!rel.relation_type ||
							!rel.fact_text
						) {
							continue; // Skip incomplete relationships
						}

						// Find entity UUIDs by name
						const sourceEntity = state.resolvedEntities?.find(
							(e) =>
								e.finalName.toLowerCase() ===
								rel.source_entity_name!.toLowerCase(),
						);
						const destEntity = state.resolvedEntities?.find(
							(e) =>
								e.finalName.toLowerCase() ===
								rel.destination_entity_name!.toLowerCase(),
						);

						if (!sourceEntity || !destEntity) {
							logInfo(
								`[EDGE_ENRICHMENT] Could not find entities for relationship: ${rel.source_entity_name} -> ${rel.destination_entity_name}`,
							);
							continue;
						}

						results.push({
							uuid: crypto.randomUUID(),
							sourceEntityId: sourceEntity.uuid,
							destinationEntityId: destEntity.uuid,
							relationType: rel.relation_type,
							factText: rel.fact_text,
							attributes: {},
						});
					}

					return results;
				} catch (parseError) {
					logError(
						"[EDGE_ENRICHMENT] JSON parsing failed, using fallback:",
						parseError,
					);
					return [];
				}
			};

			const maxModelTokens = await this.services.llm.getMaxModelTokens();

			const enrichedFacts = await mapRefine<ExtractedFact>(
				llm,
				EDGE_ENRICHMENT_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
					// Include previous results summary to maintain context
					const prevSummary =
						prev.length > 0
							? prev
									.map((p, idx) => `${idx + 1}. ${p.relationType}`)
									.join(", ")
							: "No previous results";
					let prompt = `<PREVIOUS RESULTS>\n${prevSummary}\n</PREVIOUS RESULTS>\n\n<CHUNK>\n${chunk}\n</CHUNK>`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and ensure all relationships are properly structured.\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseRelationships,
				fullText,
				{
					maxModelTokens,
					maxResponseTokens: 4096,
					temperature: 0.0,
					maxRetries: 2,
					dedupeBy: (f) =>
						`${f.sourceEntityId}|${f.destinationEntityId}|${f.relationType}`,
					onError: (error, attempt, chunk) => {
						logError(
							`[EDGE_ENRICHMENT] Parse error on attempt ${attempt}:`,
							error,
						);
						if (
							error.message.includes("JSON") ||
							error.message.includes("parse")
						) {
							return `JSON parsing failed: ${error.message}. Please ensure the response is a valid JSON array with source_entity_name, destination_entity_name, relation_type, and fact_text fields.`;
						}
						return `Edge enrichment failed on attempt ${attempt}: ${error.message}. Please retry with correct JSON format.`;
					},
				},
			);

			logInfo(
				`[EDGE_ENRICHMENT] Created ${enrichedFacts.length} new relationships for isolated nodes`,
			);

			// Add enriched facts to extractedFacts so they go through normal fact resolution
			const updatedExtractedFacts = [
				...(state.extractedFacts || []),
				...enrichedFacts,
			];

			return {
				extractedFacts: updatedExtractedFacts,
				processingStage: "temporal_extraction",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Edge Enrichment Complete",
						description: `Enriched ${isolatedNodes.length} isolated nodes with ${enrichedFacts.length} new relationships`,
						metadata: {
							isolatedNodes: isolatedNodes.length,
							newRelationships: enrichedFacts.length,
						},
					},
				],
			};
		} catch (error) {
			logError("[EDGE_ENRICHMENT] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Edge enrichment failed",
				],
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Edge Enrichment Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}
}
