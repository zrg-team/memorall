import type {
	ExtractedEntity,
	KnowledgeGraphState,
	ResolvedEntity,
} from "./state";
import type { AllServices } from "@/services/flows/interfaces/tool";
import type { Node } from "@/services/database/entities/nodes";
import { logInfo, logError } from "@/utils/logger";
import { mapRefine } from "@/utils/map-refine";

const ENTITY_RESOLUTION_SYSTEM_PROMPT = `Given the EXISTING NODES and NEW NODES, determine for EACH NEW NODE whether it represents the same real-world entity as any existing node.

Task:
For each new node, determine:
1. If the New Node represents the same entity as any node in Existing Nodes, set 'is_duplicate: true'. Otherwise, set 'is_duplicate: false'
2. If is_duplicate is true, also return the uuid of the existing node
3. If is_duplicate is true, return the most complete and accurate name to use

Guidelines:
1. Consider both the name and summary/description to determine if entities are duplicates
2. Entities can be duplicates even with different names (e.g., "Dr. Smith" and "John Smith", "Google" and "Google Inc.")
3. Consider context clues from the content source (same document/page often refers to same entities consistently)
4. For organizations: Consider subsidiaries, divisions, and alternate names
5. For people: Consider titles, nicknames, and formal vs informal names
6. For concepts: Consider synonyms and related terms that refer to the same thing
7. When in doubt, prefer marking as NOT duplicate to avoid incorrect merging
8. Process all entities in the provided list
9. Return results in the same order as the input entities

Return your response as a valid JSON array with objects matching this structure:
[
  {
    "is_duplicate": boolean,
    "existing_id": "uuid or null",
    "final_name": "Most complete and accurate name to use"
  },
  ...
]`;

export class EntityResolutionFlow {
	constructor(private services: AllServices) {}

	async resolveEntities(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			logInfo(
				"[ENTITY_RESOLUTION] Starting entity resolution with manual + AI",
			);

			if (!state.extractedEntities || state.extractedEntities.length === 0) {
				return {
					resolvedEntities: [],
					processingStage: "fact_extraction",
					actions: [
						{
							id: crypto.randomUUID(),
							name: "Entity Resolution Skipped",
							description: "No entities to resolve",
							metadata: { totalEntities: 0 },
						},
					],
				};
			}

			// Step 1: Manual resolution - check for exact name matches
			const manuallyResolved: ResolvedEntity[] = [];
			const needsAIResolution: ExtractedEntity[] = [];

			const existingNodesByName = new Map<string, Node>();
			for (const node of state.existingNodes) {
				const normalizedName = node.name.toLowerCase().trim();
				existingNodesByName.set(normalizedName, node);
			}

			for (const entity of state.extractedEntities) {
				const normalizedEntityName = entity.name.toLowerCase().trim();
				const existingNode = existingNodesByName.get(normalizedEntityName);

				if (existingNode) {
					// Exact match found - reuse existing node
					manuallyResolved.push({
						...entity,
						isExisting: true,
						existingId: existingNode.id,
						finalName: existingNode.name, // Use existing node's name
					});
					logInfo(
						`[ENTITY_RESOLUTION] Manual match: "${entity.name}" -> existing node "${existingNode.name}" (${existingNode.id})`,
					);
				} else {
					// No exact match - needs AI resolution
					needsAIResolution.push(entity);
				}
			}

			logInfo(
				`[ENTITY_RESOLUTION] Manual resolution: ${manuallyResolved.length} exact matches, ${needsAIResolution.length} need AI`,
			);

			// If all entities were manually resolved, return early
			if (needsAIResolution.length === 0) {
				return {
					resolvedEntities: manuallyResolved,
					processingStage: "fact_extraction",
					actions: [
						{
							id: crypto.randomUUID(),
							name: "Entity Resolution Complete (Manual Only)",
							description: `Resolved ${manuallyResolved.length} entities via exact name matching`,
							metadata: {
								totalEntities: manuallyResolved.length,
								manualMatches: manuallyResolved.length,
								aiResolved: 0,
							},
						},
					],
				};
			}

			// Step 2: AI resolution for remaining entities
			const llm = this.services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Prepare existing nodes context
			const existingNodesText = state.existingNodes
				.map(
					(node) =>
						`ID: ${node.id}, Name: ${node.name}, Summary: ${node.summary}, Type: ${node.nodeType}`,
				)
				.join("\n");

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

			// Prepare entities text for processing (only entities needing AI resolution)
			const entitiesText = needsAIResolution
				.map(
					(entity, index) =>
						`${index + 1}. Name: ${entity.name}, Summary: ${entity.summary || "No summary"}, Type: ${entity.nodeType}`,
				)
				.join("\n");

			// Combine all content for processing
			const fullText = `${contentSection}

<EXISTING NODES>
${existingNodesText || "No existing nodes"}
</EXISTING NODES>
<NEW NODES>
${entitiesText}
</NEW NODES>`;

			interface ParsedResolution {
				is_duplicate?: boolean;
				existing_id?: string;
				final_name?: string;
			}

			const parseResolutions = (content: string): ResolvedEntity[] => {
				let cleaned = content.trim();
				if (cleaned.startsWith("```json"))
					cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
				else if (cleaned.startsWith("```"))
					cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/i, "");

				try {
					const parsedArray = JSON.parse(cleaned) as ParsedResolution[];

					if (!Array.isArray(parsedArray)) {
						throw new Error("Response is not an array");
					}

					// Map parsed resolutions to resolved entities (only for AI-resolved entities)
					const results: ResolvedEntity[] = [];
					for (
						let i = 0;
						i < Math.min(parsedArray.length, needsAIResolution.length);
						i++
					) {
						const entity = needsAIResolution[i];
						const resolution = parsedArray[i] || {
							is_duplicate: false,
							final_name: entity.name,
						};

						results.push({
							...entity,
							isExisting: resolution.is_duplicate || false,
							existingId: resolution.existing_id,
							finalName: resolution.final_name || entity.name,
						});
					}

					// Handle any remaining entities that weren't in the response
					for (let i = parsedArray.length; i < needsAIResolution.length; i++) {
						const entity = needsAIResolution[i];
						results.push({
							...entity,
							isExisting: false,
							finalName: entity.name,
						});
					}

					return results;
				} catch (parseError) {
					logError(
						"[ENTITY_RESOLUTION] JSON parsing failed, using fallback:",
						parseError,
					);

					// Fallback: assume all AI-resolution entities are new
					return needsAIResolution.map((entity) => ({
						...entity,
						isExisting: false,
						finalName: entity.name,
					}));
				}
			};

			const maxModelTokens = await this.services.llm.getMaxModelTokens();

			const aiResolvedEntities = await mapRefine<ResolvedEntity>(
				llm,
				ENTITY_RESOLUTION_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
					// Include previous results summary to maintain context
					const prevSummary =
						prev.length > 0
							? prev
									.map(
										(p, idx) =>
											`${idx + 1}. ${p.finalName} (${p.isExisting ? "existing" : "new"})`,
									)
									.join(", ")
							: "No previous results";
					let prompt = `<PREVIOUS RESULTS>\n${prevSummary}\n</PREVIOUS RESULTS>\n\n<CHUNK>\n${chunk}\n</CHUNK>`;

					if (errorContext) {
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\nPlease fix the JSON format and ensure all entity resolutions are properly structured.\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseResolutions,
				fullText,
				{
					maxModelTokens,
					maxResponseTokens: 4096,
					temperature: 0.0,
					maxRetries: 2,
					dedupeBy: (e) => `${e.name.toLowerCase()}|${e.nodeType}`,
					onError: (error, attempt, chunk) => {
						logError(
							`[ENTITY_RESOLUTION] Parse error on attempt ${attempt}:`,
							error,
						);
						if (
							error.message.includes("JSON") ||
							error.message.includes("parse")
						) {
							return `JSON parsing failed: ${error.message}. Please ensure the response is a valid JSON array with is_duplicate, existing_id, and final_name fields.`;
						}
						return `Resolution failed on attempt ${attempt}: ${error.message}. Please retry with correct JSON format.`;
					},
				},
			);

			// Combine manual and AI-resolved entities
			const allResolvedEntities = [...manuallyResolved, ...aiResolvedEntities];

			logInfo(
				`[ENTITY_RESOLUTION] Resolved ${allResolvedEntities.length} entities (${manuallyResolved.length} manual, ${aiResolvedEntities.length} AI)`,
			);

			return {
				resolvedEntities: allResolvedEntities,
				processingStage: "fact_extraction",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Entity Resolution Complete",
						description: `Resolved ${allResolvedEntities.length} entities. ${allResolvedEntities.filter((e) => e.isExisting).length} existing, ${allResolvedEntities.filter((e) => !e.isExisting).length} new (${manuallyResolved.length} manual matches, ${aiResolvedEntities.length} AI resolved)`,
						metadata: {
							totalEntities: allResolvedEntities.length,
							existingEntities: allResolvedEntities.filter((e) => e.isExisting)
								.length,
							newEntities: allResolvedEntities.filter((e) => !e.isExisting)
								.length,
							manualMatches: manuallyResolved.length,
							aiResolved: aiResolvedEntities.length,
						},
					},
				],
			};
		} catch (error) {
			logError("[ENTITY_RESOLUTION] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Entity resolution failed",
				],
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Entity Resolution Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}
}
