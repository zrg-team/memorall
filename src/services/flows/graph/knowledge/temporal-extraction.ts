import type { KnowledgeGraphState, EnrichedFact, TemporalInfo } from "./state";
import type { AllServices } from "@/services/flows/interfaces/tool";
import { logInfo, logError } from "@/utils/logger";
import { mapRefine } from "@/utils/map-refine";

const TEMPORAL_EXTRACTION_SYSTEM_PROMPT = `Extract temporal information (dates and times) that are directly related to when the relationships in the provided facts were established, changed, or ended.

IMPORTANT: Only extract time information if it is explicitly mentioned in relation to the fact. Do not infer or assume dates.

Definitions:
- valid_at: The date and time when the relationship described by the fact became true or was established.
- invalid_at: The date and time when the relationship described by the fact stopped being true or ended.

Task:
For each provided fact, analyze the content and determine if there are dates that directly relate to when the relationship was formed, changed, or ended.

Guidelines:
1. Use ISO 8601 format (YYYY-MM-DDTHH:MM:SS.SSSSSSZ) for all datetimes.
2. Use the reference timestamp as the current time when calculating relative time references.
3. For content stating present relationships without explicit dates, use the reference timestamp for valid_at.
4. For web pages/documents: Extract publication dates, creation dates, when events occurred.
5. For conversations: Extract when relationships were formed, changed, or mentioned.
6. For selected text: Focus on temporal information within the selection.
7. Only set dates that are explicitly stated in relation to the relationship itself.
8. For relative time mentions (e.g., "2 years ago", "last month"), calculate the actual datetime based on the reference timestamp.
9. If only a date is mentioned without time, use 00:00:00 (midnight) for that date.
10. If only a year is mentioned, use January 1st of that year at 00:00:00.
11. Always include the time zone offset (use Z for UTC if no specific time zone is mentioned).
12. If no temporal information is found for a relationship, leave both fields as null.
13. Process all facts in the provided list in the same order.

Return your response as a valid JSON array with objects matching this structure:
[
  {
    "valid_at": "YYYY-MM-DDTHH:MM:SS.SSSSSSZ or null",
    "invalid_at": "YYYY-MM-DDTHH:MM:SS.SSSSSSZ or null"
  },
  ...
]`;

export class TemporalExtractionFlow {
	constructor(private services: AllServices) {}

	async extractTemporal(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			logInfo(
				"[TEMPORAL_EXTRACTION] Starting temporal extraction with chunking",
			);

			if (!state.resolvedFacts || state.resolvedFacts.length === 0) {
				return {
					enrichedFacts: [],
					processingStage: "database_operations",
					actions: [
						{
							id: crypto.randomUUID(),
							name: "Temporal Extraction Skipped",
							description: "No facts to process for temporal information",
							metadata: { totalFacts: 0 },
						},
					],
				};
			}

			// Filter facts that have valid entity references
			const validFacts = state.resolvedFacts.filter((fact) => {
				const sourceEntity = state.resolvedEntities?.find(
					(e) => e.uuid === fact.sourceEntityId,
				);
				const destEntity = state.resolvedEntities?.find(
					(e) => e.uuid === fact.destinationEntityId,
				);

				if (!sourceEntity || !destEntity) {
					logError(
						`[TEMPORAL_EXTRACTION] Could not find entities for fact: ${fact.sourceEntityId} -> ${fact.destinationEntityId}`,
					);
					return false;
				}
				return true;
			});

			// Helper function to validate ISO 8601 dates
			const validateDate = (
				dateStr: string | undefined,
			): string | undefined => {
				if (!dateStr || dateStr === "null") return undefined;
				try {
					new Date(dateStr);
					return dateStr;
				} catch {
					logError(`[TEMPORAL_EXTRACTION] Invalid date format: ${dateStr}`);
					return undefined;
				}
			};

			// Parse temporal information from LLM response
			const parseTemporal = (response: string): EnrichedFact[] => {
				interface ParsedTemporal {
					valid_at?: string;
					invalid_at?: string;
				}

				try {
					// Clean and parse JSON response
					const cleaned = response.replace(/```json|```/g, "").trim();
					const parsedArray = JSON.parse(cleaned) as ParsedTemporal[];

					if (!Array.isArray(parsedArray)) {
						throw new Error("Response is not an array");
					}

					// Ensure we have results for all facts
					const results: EnrichedFact[] = [];
					for (let i = 0; i < validFacts.length; i++) {
						const fact = validFacts[i];
						const temporal = parsedArray[i] || {
							valid_at: undefined,
							invalid_at: undefined,
						};

						const temporalInfo: TemporalInfo = {
							validAt: validateDate(temporal.valid_at),
							invalidAt: validateDate(temporal.invalid_at),
						};

						results.push({
							...fact,
							temporal: temporalInfo,
						});
					}

					return results;
				} catch (parseError) {
					logError("[TEMPORAL_EXTRACTION] JSON parsing failed:", parseError);
					throw parseError;
				}
			};

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

			const fullText = `${contentSection}

<REFERENCE TIMESTAMP>
${state.referenceTimestamp}
</REFERENCE TIMESTAMP>`;

			// Use mapRefine for temporal extraction with retry and error handling
			const enrichedFacts = await mapRefine<EnrichedFact>(
				this.services.llm,
				TEMPORAL_EXTRACTION_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
					const factsInChunk = chunk.split("\n").filter((line) => line.trim());
					let prompt = `${fullText}\n<FACTS>\n${chunk}\n</FACTS>`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and ensure all temporal information is properly extracted.\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseTemporal,
				validFacts
					.map((fact, index) => {
						const sourceEntity = state.resolvedEntities?.find(
							(e) => e.uuid === fact.sourceEntityId,
						);
						const destEntity = state.resolvedEntities?.find(
							(e) => e.uuid === fact.destinationEntityId,
						);
						return `${index + 1}. Source: ${sourceEntity?.finalName || "Unknown"}, Destination: ${destEntity?.finalName || "Unknown"}, Relation: ${fact.relationType}, Fact Text: ${fact.factText}`;
					})
					.join("\n"),
				{
					maxModelTokens: 10000,
					maxResponseTokens: 4096,
					temperature: 0.0,
					maxRetries: 2,
					dedupeBy: (f) =>
						`${f.sourceEntityId}|${f.destinationEntityId}|${f.relationType}`,
					onError: (error, attempt, chunk) => {
						logError(
							`[TEMPORAL_EXTRACTION] Parse error on attempt ${attempt}:`,
							error,
						);
						if (
							error.message.includes("JSON") ||
							error.message.includes("parse")
						) {
							return `JSON parsing failed: ${error.message}. Please ensure the response is a valid JSON array with valid_at and invalid_at fields in ISO 8601 format.`;
						}
						return `Temporal extraction failed on attempt ${attempt}: ${error.message}. Please retry with correct JSON format.`;
					},
				},
			);

			// Add back any invalid facts without temporal info
			const invalidFacts = state.resolvedFacts
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
					temporal: { validAt: undefined, invalidAt: undefined },
				}));

			const allEnrichedFacts = [...enrichedFacts, ...invalidFacts];

			const factsWithTemporal = allEnrichedFacts.filter(
				(f) => f.temporal.validAt || f.temporal.invalidAt,
			);

			logInfo(
				`[TEMPORAL_EXTRACTION] Enriched ${allEnrichedFacts.length} facts. ${factsWithTemporal.length} have temporal information`,
			);

			return {
				enrichedFacts: allEnrichedFacts,
				processingStage: "database_operations",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Temporal Extraction Complete",
						description: `Processed ${allEnrichedFacts.length} facts. ${factsWithTemporal.length} have temporal information`,
						metadata: {
							totalFacts: allEnrichedFacts.length,
							factsWithTemporal: factsWithTemporal.length,
							invalidFacts: invalidFacts.length,
						},
					},
				],
			};
		} catch (error) {
			logError("[TEMPORAL_EXTRACTION] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Temporal extraction failed",
				],
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Temporal Extraction Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}
}
