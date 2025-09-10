import type { KnowledgeGraphState, ExtractedFact } from "./state";
import { logInfo, logError } from "@/utils/logger";
import { mapRefine } from "@/utils/map-refine";
import type { AllServices } from "@/services/flows/interfaces/tool";

const FACT_EXTRACTION_SYSTEM_PROMPT = `Extract all factual relationships between the provided ENTITIES from the given CONTENT.

Guidelines:
1. Extract facts only between entities that appear in the provided ENTITIES list.
2. Each fact should represent a clear relationship between two DISTINCT entities.
3. The relation_type should be a concise, all-caps description of the relationship (e.g., WORKS_FOR, CREATED_BY, LOCATED_IN, FOUNDED, ACQUIRED, COLLABORATED_WITH).
4. The fact_text should contain the complete factual description including relevant context and details.
5. For web pages/documents: Extract authorship, organizational relationships, creation relationships, ownership, etc.
6. For conversations: Extract social relationships, professional connections, opinions expressed, etc.
7. For selected text: Focus on relationships explicitly mentioned in the selection.
8. Include temporal context when mentioned (this will be processed separately for precise dates).
9. Avoid creating relationships based on mere co-occurrence - ensure there's an actual stated relationship.

Return your response as a valid JSON array of objects with the following structure:
[
  {
    "source_entity": "Entity Name 1",
    "destination_entity": "Entity Name 2",
    "relation_type": "RELATION_TYPE",
    "fact_text": "Complete factual description of the relationship with context",
    "attributes": {}
  }
]`;

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
					let prompt = `<PREVIOUS RESULT>\n${prevSummary}\n</PREVIOUS RESULT>\n<CHUNK>\n${chunk}\n</CHUNK>`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and ensure all facts are properly extracted with correct entity relationships.\n</ERROR_CONTEXT>`;
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
					onError: (error, attempt, chunk) => {
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

			return {
				extractedFacts,
				processingStage: "fact_resolution",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Fact Extraction Complete",
						description: `Extracted ${extractedFacts.length} facts from content`,
						metadata: { factCount: extractedFacts.length },
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
}
