import type { KnowledgeGraphState, ResolvedFact, ExtractedFact } from "./state";
import type { AllServices } from "@/services/flows/interfaces/tool";
import { logInfo, logError } from "@/utils/logger";
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
			logInfo("[FACT_RESOLUTION] Starting fact resolution with mapRefine");

			if (!state.extractedFacts || state.extractedFacts.length === 0) {
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

			const llm = this.services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Build node name lookup
			const nodeNameById = new Map<string, string>();
			for (const n of state.existingNodes || []) {
				nodeNameById.set(n.id, n.name);
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

			// Prepare existing edges text
			const existingEdgesText = (state.existingEdges || [])
				.map((edge) => {
					const sourceName = nodeNameById.get(edge.sourceId) || "Unknown";
					const destName = nodeNameById.get(edge.destinationId) || "Unknown";
					return `ID: ${edge.id}, Source: ${sourceName}, Destination: ${destName}, Type: ${edge.edgeType}, Fact: ${edge.factText}`;
				})
				.join("\n");

			// Prepare facts text for processing
			const factsText = validFacts
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

					// Map parsed resolutions to resolved facts
					const results: ResolvedFact[] = [];
					for (
						let i = 0;
						i < Math.min(parsedArray.length, validFacts.length);
						i++
					) {
						const fact = validFacts[i];
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
					for (let i = parsedArray.length; i < validFacts.length; i++) {
						const fact = validFacts[i];
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

					// Fallback: assume all facts are new
					return validFacts.map((fact) => ({
						...fact,
						isExisting: false,
					}));
				}
			};

			const resolvedValidFacts = await mapRefine<ResolvedFact>(
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
					maxModelTokens: 10000,
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

			const allResolvedFacts = [...resolvedValidFacts, ...invalidFacts];

			logInfo(`[FACT_RESOLUTION] Resolved ${allResolvedFacts.length} facts`);

			return {
				resolvedFacts: allResolvedFacts,
				processingStage: "temporal_extraction",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Fact Resolution Complete",
						description: `Resolved ${allResolvedFacts.length} facts. ${allResolvedFacts.filter((f) => f.isExisting).length} existing, ${allResolvedFacts.filter((f) => !f.isExisting).length} new`,
						metadata: {
							totalFacts: allResolvedFacts.length,
							existingFacts: allResolvedFacts.filter((f) => f.isExisting)
								.length,
							newFacts: allResolvedFacts.filter((f) => !f.isExisting).length,
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
