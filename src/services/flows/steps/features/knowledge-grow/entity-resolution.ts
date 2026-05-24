import { logInfo, logError } from "../../../interfaces/logger";
import { mapRefine } from "../../../utils/map-refine";

import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import type { AllServices } from "../../../interfaces/tool";
import { UuidMapper } from "../../../utils/uuid-mapping";

const STEP_NAME = "entity-resolution" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ExtractedEntity {
	uuid: string;
	name: string;
	summary?: string | null;
	nodeType: string;
	attributes?: Record<string, unknown>;
}

export interface ExistingNode {
	id: string;
	name: string;
	nodeType: string;
	summary?: string | null;
}

export interface ResolvedEntity {
	uuid: string;
	name: string;
	summary?: string | null;
	nodeType: string;
	attributes: Record<string, unknown>;
	isExisting: boolean;
	existingId?: string;
	finalName: string;
}

export interface EntityResolutionInput {
	currentMessage: string;
	previousMessages?: string;
	url?: string;
	title?: string;
	extractedEntities: ExtractedEntity[];
	existingNodes: ExistingNode[];
}

export interface EntityResolutionOutput {
	resolvedEntities?: ResolvedEntity[];
	processingStage?: string;
	errors?: string[];
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

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

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	EntityResolutionInput,
	EntityResolutionOutput,
	AllServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			logInfo(
				"[ENTITY_RESOLUTION] Starting entity resolution with manual + AI",
			);

			if (!input.extractedEntities || input.extractedEntities.length === 0) {
				const actions = [
					{
						id: crypto.randomUUID(),
						name: "Entity Resolution Skipped",
						description: "No entities to resolve",
						metadata: { totalEntities: 0 },
					},
				];
				runConfig?.writer?.({ type: "actions", actions });

				return {
					output: {
						resolvedEntities: [],
						processingStage: "fact_extraction",
					},
				};
			}

			// Step 1: Manual resolution - check for exact name matches
			const manuallyResolved: ResolvedEntity[] = [];
			const needsAIResolution: ExtractedEntity[] = [];

			const existingNodesByName = new Map<string, ExistingNode>();
			for (const node of input.existingNodes || []) {
				const normalizedName = node.name.toLowerCase().trim();
				existingNodesByName.set(normalizedName, node);
			}

			for (const entity of input.extractedEntities) {
				const normalizedEntityName = entity.name.toLowerCase().trim();
				const existingNode = existingNodesByName.get(normalizedEntityName);

				if (existingNode) {
					// Exact match found - reuse existing node
					manuallyResolved.push({
						...entity,
						isExisting: true,
						existingId: existingNode.id,
						finalName: existingNode.name,
						attributes: entity.attributes || {},
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
				const actions = [
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
				];
				runConfig?.writer?.({ type: "actions", actions });

				return {
					output: {
						resolvedEntities: manuallyResolved,
						processingStage: "fact_extraction",
					},
				};
			}

			// Step 2: AI resolution for remaining entities
			const llm = services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Prepare existing nodes context
			const existingNodesText = (input.existingNodes || [])
				.map(
					(node) =>
						`ID: ${node.id}, Name: ${node.name}, Summary: ${node.summary || "No summary"}, Type: ${node.nodeType}`,
				)
				.join("\n");

			// Format content with proper context
			let contentSection = `<CONTENT>\n${input.currentMessage}\n</CONTENT>`;

			if (input.previousMessages && input.previousMessages.trim().length > 0) {
				contentSection = `<CONTEXT>\n${input.previousMessages}\n</CONTEXT>\n\n${contentSection}`;
			}

			if (input.url || input.title) {
				const metadata = [];
				if (input.title) metadata.push(`Title: ${input.title}`);
				if (input.url) metadata.push(`Source: ${input.url}`);
				contentSection = `<METADATA>\n${metadata.join("\n")}\n</METADATA>\n\n${contentSection}`;
			}

			// Prepare entities text for processing
			const entitiesText = needsAIResolution
				.map(
					(entity, index) =>
						`${index + 1}. Name: ${entity.name}, Summary: ${entity.summary || "No summary"}, Type: ${entity.nodeType}`,
				)
				.join("\n");

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

			// Create UUID mapper for this resolution session
			const uuidMapper = new UuidMapper();

			// Convert ExistingNode[] to Node[] format for UuidMapper
			const nodesForMapper = (input.existingNodes || []).map((node) => ({
				id: node.id,
				name: node.name,
				nodeType: node.nodeType,
				summary: node.summary,
			}));

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

						const finalName = resolution.final_name || entity.name;
						const isDuplicate = resolution.is_duplicate || false;

						// Use UUID mapper to get correct UUID
						const mappingResult = uuidMapper.mapEntityUuid(
							entity.name,
							resolution.existing_id,
							finalName,
							nodesForMapper,
						);

						if (isDuplicate && !mappingResult.isExisting) {
							logInfo(
								`[ENTITY_RESOLUTION] LLM marked entity "${entity.name}" as duplicate but could not find matching node. Created new entity with UUID: ${mappingResult.correctUuid}`,
							);
						}

						results.push({
							...entity,
							uuid: mappingResult.correctUuid,
							isExisting: mappingResult.isExisting,
							existingId: mappingResult.isExisting
								? mappingResult.correctUuid
								: undefined,
							finalName: mappingResult.finalName || finalName,
							attributes: entity.attributes || {},
						});
					}

					// Handle any remaining entities that weren't in the response
					for (let i = parsedArray.length; i < needsAIResolution.length; i++) {
						const entity = needsAIResolution[i];
						const mappingResult = uuidMapper.mapEntityUuid(
							entity.name,
							undefined,
							entity.name,
							nodesForMapper,
						);

						results.push({
							...entity,
							uuid: mappingResult.correctUuid,
							isExisting: false,
							finalName: entity.name,
							attributes: entity.attributes || {},
						});
					}

					return results;
				} catch (parseError) {
					logError(
						"[ENTITY_RESOLUTION] JSON parsing failed, using fallback:",
						parseError,
					);

					// Fallback: assume all AI-resolution entities are new with generated UUIDs
					return needsAIResolution.map((entity) => {
						const mappingResult = uuidMapper.mapEntityUuid(
							entity.name,
							undefined,
							entity.name,
							nodesForMapper,
						);

						return {
							...entity,
							uuid: mappingResult.correctUuid,
							isExisting: false,
							finalName: entity.name,
							attributes: entity.attributes || {},
						};
					});
				}
			};

			const maxModelTokens = await services.llm.getMaxModelTokens();
			const maxResponseTokens = await services.llm.getMaxResponseTokens();

			const aiResolvedEntities = await mapRefine<ResolvedEntity>(
				llm,
				ENTITY_RESOLUTION_SYSTEM_PROMPT,
				(chunk, prev, errorContext) => {
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
					maxResponseTokens,
					temperature: 0.0,
					maxRetries: 2,
					dedupeBy: (e) => `${e.name.toLowerCase()}|${e.nodeType}`,
					onError: (error, attempt) => {
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

			const actions = [
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
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					resolvedEntities: allResolvedEntities,
					processingStage: "fact_extraction",
				},
			};
		} catch (error) {
			logError("[ENTITY_RESOLUTION] Error:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Entity Resolution Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error ? error.message : "Entity resolution failed",
					],
				},
			};
		}
	},
});

type EntityResolutionSpec = StepSpecFromDefinition<typeof definition>;

export const createEntityResolutionStep: StepFactoryFromSpec<
	EntityResolutionSpec
> = (services: AllServices) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createEntityResolutionStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: EntityResolutionSpec;
	}
}
