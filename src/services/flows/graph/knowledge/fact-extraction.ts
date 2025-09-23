import type { KnowledgeGraphState, ExtractedFact } from "./state";
import { logInfo, logError } from "@/utils/logger";
import { mapRefine } from "@/utils/map-refine";
import type { AllServices } from "@/services/flows/interfaces/tool";
import type { ILLMService } from "@/services/llm/interfaces/llm-service.interface";

const FACT_EXTRACTION_SYSTEM_PROMPT = `Extract ALL possible factual relationships between the provided ENTITIES from the given CONTENT. Your goal is to generate as many edges as possible for the knowledge graph.

CRITICAL ENTITY MATCHING RULES:
1. The "source_entity" and "destination_entity" fields MUST contain the EXACT entity names from the ENTITIES list below.
2. Do NOT modify, abbreviate, or paraphrase entity names - use them EXACTLY as they appear in the ENTITIES list.
3. If you're uncertain about an entity name, choose the closest EXACT match from the provided list.

RELATIONSHIP EXTRACTION GUIDELINES:
1. Extract facts ONLY between entities that appear in the provided ENTITIES list.
2. Generate as many relationships as possible - be comprehensive and thorough.
3. Each fact should represent a clear relationship between two DISTINCT entities.
4. Look for DIRECT relationships (explicit connections) AND INDIRECT relationships (implied by context).
5. The relation_type should be a concise, all-caps description (e.g., WORKS_FOR, CREATED_BY, LOCATED_IN, FOUNDED, ACQUIRED, COLLABORATED_WITH, MENTIONED_WITH, RELATED_TO).
6. The fact_text should contain the complete factual description including relevant context and details.
7. Include temporal context when mentioned (this will be processed separately for precise dates).

COMPREHENSIVE EXTRACTION STRATEGY:
- For web pages/documents: Extract authorship, organizational relationships, creation relationships, ownership, mentions, citations, etc.
- For conversations: Extract social relationships, professional connections, opinions expressed, co-mentions, etc.
- For any content: Look for co-occurrence relationships, hierarchical relationships, temporal relationships, causal relationships.
- Create "MENTIONED_WITH" or "RELATED_TO" relationships for entities that appear together even without explicit connection.
- Don't miss subtle relationships - if two entities appear in the same context, there's likely some relationship.

ENTITY NAME MATCHING EXAMPLES:
✅ Correct: If entity list contains "Apple Inc.", use "Apple Inc." exactly
❌ Wrong: Using "Apple", "Apple Corporation", or "apple inc."

✅ Correct: If entity list contains "John Smith", use "John Smith" exactly
❌ Wrong: Using "John", "Smith", or "john smith"

Return your response as a valid JSON array of objects with the following structure:
[
  {
    "source_entity": "Exact Entity Name From List",
    "destination_entity": "Exact Entity Name From List",
    "relation_type": "RELATION_TYPE",
    "fact_text": "Complete factual description of the relationship with context",
    "attributes": {}
  }
]

REMEMBER: Use entity names EXACTLY as they appear in the ENTITIES list, and extract as many relationships as possible!`;

const UNCONNECTED_EXTRACTION_PROMPT = `You previously extracted relationships, but some entities still have NO connections. Your task is to find ANY possible relationships for these unconnected entities.

UNCONNECTED ENTITIES (find relationships for these):
{{nodes}}

CRITICAL REQUIREMENTS:
1. Focus SPECIFICALLY on the unconnected entities listed above
2. Use EXACT entity names from the ENTITIES list below
3. Look for ANY type of relationship: explicit, implicit, contextual, or co-occurrence
4. Generate relationships between unconnected entities and ANY other entities in the list
5. Be creative but accurate - if entities appear in the same context, create "MENTIONED_WITH" or "RELATED_TO" relationships
6. Don't leave ANY entity without at least one connection if possible

RELATIONSHIP STRATEGIES:
- Direct relationships (explicit connections)
- Contextual relationships (appear in same paragraph/section)
- Hierarchical relationships (part of same category/domain)
- Temporal relationships (mentioned in same time context)
- Topical relationships (related to same subject matter)
- Co-occurrence relationships (mentioned together)

Return your response as a valid JSON array of objects with the following structure:
[
  {
    "source_entity": "Exact Entity Name From List",
    "destination_entity": "Exact Entity Name From List",
    "relation_type": "RELATION_TYPE",
    "fact_text": "Complete factual description of the relationship with context",
    "attributes": {}
  }
]

REMEMBER: Use entity names EXACTLY as they appear in the ENTITIES list, and focus on creating connections for the unconnected entities listed above!`;

export class FactExtractionFlow {
	constructor(private services: AllServices) {}

	async extractFacts(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			const llm = this.services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			logInfo("[FACT_EXTRACTION] Starting fact extraction");

			const entitiesText = state.resolvedEntities
				.map(
					(entity) =>
						`- ${entity.finalName}: ${entity.summary || "No description"}`,
				)
				.join("\n");

			// Format content with proper context
			let formattedContent = `<CONTENT>\n${state.currentMessage}\n</CONTENT>`;

			// Add context if available
			if (state.previousMessages && state.previousMessages.trim().length > 0) {
				formattedContent = `<CONTEXT>\n${state.previousMessages}\n</CONTEXT>\n\n${formattedContent}`;
			}

			// Add metadata for better understanding
			if (state.url || state.title) {
				const metadata = [];
				if (state.title) metadata.push(`Title: ${state.title}`);
				if (state.url) metadata.push(`Source: ${state.url}`);
				formattedContent = `<METADATA>\n${metadata.join("\n")}\n</METADATA>\n\n${formattedContent}`;
			}

			// Add entities list
			const fullText = `${formattedContent}\n\n<ENTITIES>\n${entitiesText}\n</ENTITIES>`;

			interface ParsedFact {
				source_entity?: string;
				destination_entity?: string;
				relation_type?: string;
				fact_text?: string;
				attributes?: Record<string, unknown>;
			}

			const nameToId = new Map<string, string>();
			for (const e of state.resolvedEntities) {
				// Use finalName as primary mapping, but only add name mapping if it doesn't conflict
				const finalNameKey = e.finalName.toLowerCase();
				const originalNameKey = e.name.toLowerCase();

				nameToId.set(finalNameKey, e.uuid);

				// Only add original name mapping if it's different and not already taken
				if (
					originalNameKey !== finalNameKey &&
					!nameToId.has(originalNameKey)
				) {
					nameToId.set(originalNameKey, e.uuid);
				}

				// Also try common variations for better matching
				const trimmedFinal = e.finalName.trim().toLowerCase();
				const trimmedOriginal = e.name.trim().toLowerCase();

				if (trimmedFinal !== finalNameKey && !nameToId.has(trimmedFinal)) {
					nameToId.set(trimmedFinal, e.uuid);
				}
				if (
					trimmedOriginal !== originalNameKey &&
					!nameToId.has(trimmedOriginal)
				) {
					nameToId.set(trimmedOriginal, e.uuid);
				}
			}

			let allAccumulatedFacts: ExtractedFact[] = [];

			const parseFacts = (content: string): ExtractedFact[] => {
				let cleaned = content.trim();
				if (cleaned.startsWith("```json"))
					cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
				else if (cleaned.startsWith("```"))
					cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/i, "");
				try {
					const parsed: unknown = JSON.parse(cleaned);
					if (Array.isArray(parsed)) {
						const newFacts = parsed
							.map((f): ExtractedFact | null => {
								const pf = f as ParsedFact;
								const src = nameToId.get(
									(pf.source_entity ?? "").toLowerCase(),
								);
								const dst = nameToId.get(
									(pf.destination_entity ?? "").toLowerCase(),
								);
								if (!src || !dst) return null;
								const relation = pf.relation_type ?? "RELATED_TO";
								const factText =
									pf.fact_text ??
									`${pf.source_entity} ${relation} ${pf.destination_entity}`;

								// Check if similar fact already exists
								const existingFactIndex = allAccumulatedFacts.findIndex(
									(existing) =>
										existing.sourceEntityId === src &&
										existing.destinationEntityId === dst &&
										existing.relationType === relation,
								);

								if (existingFactIndex >= 0) {
									// Merge with existing fact
									const existing = allAccumulatedFacts[existingFactIndex];
									const mergedFactText = existing.factText.includes(factText)
										? existing.factText
										: `${existing.factText}. ${factText}`;
									const mergedAttributes = {
										...existing.attributes,
										...(pf.attributes ?? {}),
									};

									// Update existing fact
									allAccumulatedFacts[existingFactIndex] = {
										...existing,
										factText: mergedFactText,
										attributes: mergedAttributes,
									};
									return null; // Don't add as new fact
								}

								return {
									uuid: crypto.randomUUID(),
									sourceEntityId: src,
									destinationEntityId: dst,
									relationType: relation,
									factText,
									attributes: pf.attributes ?? {},
								};
							})
							.filter((f): f is ExtractedFact => f !== null);

						// Add new facts to accumulated facts
						allAccumulatedFacts.push(...newFacts);
						return [...allAccumulatedFacts];
					}
				} catch {
					const matches =
						cleaned.match(/([\w\s]+)\s+([\w_]+)\s+([\w\s]+)/g) || [];
					const newFacts = matches
						.map((m): ExtractedFact | null => {
							const parts = m.trim().split(/\s+/);
							if (parts.length < 3) return null;
							const srcName = parts.slice(0, -2).join(" ").toLowerCase();
							const rel = parts[parts.length - 2].toUpperCase();
							const dstName = parts[parts.length - 1].toLowerCase();
							const src = nameToId.get(srcName);
							const dst = nameToId.get(dstName);
							if (!src || !dst) return null;

							// Check if similar fact already exists
							const existingFactIndex = allAccumulatedFacts.findIndex(
								(existing) =>
									existing.sourceEntityId === src &&
									existing.destinationEntityId === dst &&
									existing.relationType === rel,
							);

							if (existingFactIndex >= 0) {
								// Merge with existing fact
								const existing = allAccumulatedFacts[existingFactIndex];
								const factText = m.trim();
								const mergedFactText = existing.factText.includes(factText)
									? existing.factText
									: `${existing.factText}. ${factText}`;

								// Update existing fact
								allAccumulatedFacts[existingFactIndex] = {
									...existing,
									factText: mergedFactText,
								};
								return null; // Don't add as new fact
							}

							return {
								uuid: crypto.randomUUID(),
								sourceEntityId: src,
								destinationEntityId: dst,
								relationType: rel,
								factText: m.trim(),
								attributes: {},
							};
						})
						.filter((f): f is ExtractedFact => f !== null);

					// Add new facts to accumulated facts
					allAccumulatedFacts.push(...newFacts);
					return [...allAccumulatedFacts];
				}
				return [];
			};

			const extractedFacts = await mapRefine<ExtractedFact>(
				llm,
				FACT_EXTRACTION_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
					const prevSummary = prev
						.map((p) => {
							const sourceEntity =
								state.resolvedEntities.find((e) => e.uuid === p.sourceEntityId)
									?.finalName ?? "";
							const destEntity =
								state.resolvedEntities.find(
									(e) => e.uuid === p.destinationEntityId,
								)?.finalName ?? "";
							return `${sourceEntity} ${p.relationType} ${destEntity}`;
						})
						.join(", ");

					let prompt = `<PREVIOUS RESULT>\n${prevSummary}\n</PREVIOUS RESULT>\n<CHUNK>\n${chunk}\n</CHUNK>\n\n<ENTITIES>\n${entitiesText}\n</ENTITIES>\n\nREMINDER: Use entity names EXACTLY as they appear in the ENTITIES list above. Extract as many relationships as possible between these entities.`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and ensure all facts are properly extracted with EXACT entity name matching from the ENTITIES list.\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseFacts,
				fullText,
				{
					maxModelTokens: 10000,
					maxResponseTokens: 4096,
					temperature: 0.1,
					maxRetries: 2,
					dedupeBy: (f) =>
						`${f.sourceEntityId}|${f.relationType}|${f.destinationEntityId}|${f.factText.toLowerCase()}`,
					onError: (error, attempt) => {
						logError(
							`[FACT_EXTRACTION] Parse error on attempt ${attempt}:`,
							error,
						);
						if (
							error.message.includes("JSON") ||
							error.message.includes("parse")
						) {
							return `JSON parsing failed: ${error.message}. Please ensure the response is a valid JSON array with source_entity, destination_entity, relation_type, and fact_text fields.`;
						}
						return `Fact extraction failed on attempt ${attempt}: ${error.message}. Please retry with correct JSON format.`;
					},
				},
			);

			logInfo("[FACT_EXTRACTION] Extracted facts:", extractedFacts);

			// Find entities without any connections
			const connectedEntityIds = new Set<string>();
			extractedFacts.forEach((fact) => {
				connectedEntityIds.add(fact.sourceEntityId);
				connectedEntityIds.add(fact.destinationEntityId);
			});

			const unconnectedEntities = state.resolvedEntities.filter(
				(entity) => !connectedEntityIds.has(entity.uuid),
			);

			logInfo(
				`[FACT_EXTRACTION] Found ${unconnectedEntities.length} entities without connections:`,
				unconnectedEntities.map((e) => e.finalName),
			);

			// Generate additional facts for unconnected entities
			let additionalFacts: ExtractedFact[] = [];
			if (unconnectedEntities.length > 0) {
				additionalFacts = await this.generateFactsForUnconnectedEntities(
					unconnectedEntities,
					state,
					llm,
					fullText,
					entitiesText,
					parseFacts,
				);

				// Merge additional facts with existing ones
				extractedFacts.push(...additionalFacts);

				logInfo(
					`[FACT_EXTRACTION] Generated ${additionalFacts.length} additional facts for unconnected entities`,
				);
			}

			const totalFacts = extractedFacts.length;
			logInfo(
				`[FACT_EXTRACTION] Total extracted facts: ${totalFacts} (${totalFacts - additionalFacts.length} initial + ${additionalFacts.length} additional)`,
			);

			return {
				extractedFacts,
				processingStage: "fact_resolution",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Fact Extraction Complete",
						description: `Extracted ${totalFacts} facts from content (${additionalFacts.length} additional for unconnected entities)`,
						metadata: {
							factCount: totalFacts,
							initialFacts: totalFacts - additionalFacts.length,
							additionalFacts: additionalFacts.length,
							unconnectedEntitiesFound: unconnectedEntities.length,
						},
					},
				],
			};
		} catch (error) {
			logError("[FACT_EXTRACTION] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Fact extraction failed",
				],
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Fact Extraction Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}

	private async generateFactsForUnconnectedEntities(
		unconnectedEntities: Array<{
			uuid: string;
			finalName: string;
			summary?: string;
			nodeType: string;
		}>,
		state: KnowledgeGraphState,
		llm: ILLMService,
		fullText: string,
		entitiesText: string,
		parseFacts: (content: string) => ExtractedFact[],
	): Promise<ExtractedFact[]> {
		if (unconnectedEntities.length === 0) return [];

		const unconnectedNames = unconnectedEntities
			.map((e) => e.finalName)
			.join(", ");

		try {
			const additionalFacts = await mapRefine<ExtractedFact>(
				llm,
				UNCONNECTED_EXTRACTION_PROMPT.replace(
					"{{nodes}}",
					unconnectedEntities
						.map((e) => `- ${e.finalName}: ${e.summary || "No description"}`)
						.join("\n"),
				),
				(chunk, prev, errorContext) => {
					let prompt = `Focus on finding relationships for these unconnected entities: ${unconnectedNames}\n\n<CONTENT>\n${chunk}\n</CONTENT>\n\n<ENTITIES>\n${entitiesText}\n</ENTITIES>\n\nREMINDER: Create connections specifically for the unconnected entities listed above using EXACT entity names.`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and focus on the unconnected entities.\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseFacts,
				fullText,
				{
					maxModelTokens: 8000,
					maxResponseTokens: 3000,
					temperature: 0.2, // Slightly higher creativity for finding implicit relationships
					maxRetries: 2,
					dedupeBy: (f) =>
						`${f.sourceEntityId}|${f.relationType}|${f.destinationEntityId}`,
					onError: (error, attempt) => {
						logError(
							`[UNCONNECTED_EXTRACTION] Parse error on attempt ${attempt}:`,
							error,
						);
						return `Extraction failed: ${error.message}. Please ensure valid JSON format and focus on unconnected entities.`;
					},
				},
			);

			// Filter to only include facts that involve at least one unconnected entity
			const unconnectedEntityIds = new Set(
				unconnectedEntities.map((e) => e.uuid),
			);
			const filteredFacts = additionalFacts.filter(
				(fact) =>
					unconnectedEntityIds.has(fact.sourceEntityId) ||
					unconnectedEntityIds.has(fact.destinationEntityId),
			);

			logInfo(
				`[UNCONNECTED_EXTRACTION] Generated ${filteredFacts.length} relationships for unconnected entities`,
			);

			return filteredFacts;
		} catch (error) {
			logError(
				"[UNCONNECTED_EXTRACTION] Error generating facts for unconnected entities:",
				error,
			);
			return [];
		}
	}
}
