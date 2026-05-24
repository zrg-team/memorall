import { logInfo, logError } from "../../../interfaces/logger";
import { mapRefine } from "../../../utils/map-refine";

import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import type { AllServices } from "../../../interfaces/tool";

const STEP_NAME = "entity-extraction" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ExtractedEntity {
	uuid: string;
	name: string;
	summary?: string;
	nodeType: string;
	attributes: Record<string, unknown>;
}

export interface EntityExtractionInput {
	currentMessage: string;
	previousMessages?: string;
	url?: string;
	title?: string;
	sourceType?: string;
	isSpecificTextConversion?: boolean;
}

export interface EntityExtractionOutput {
	extractedEntities?: ExtractedEntity[];
	processingStage?: string;
	errors?: string[];
}

// ============================================================================
// SYSTEM PROMPTS
// ============================================================================

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are an expert entity extraction specialist. Extract clean, precise entity nodes from the provided CONTENT.

CRITICAL NAMING RULES:
1. Convert first-person pronouns to represent the user:
   - "I", "me", "my", "myself" → "Memorall User"
   - Always create a "Memorall User" entity for user references
   - Use nodeType "USER" for the main user entity

2. Extract MAXIMUM entities - be extremely comprehensive:
   - Every person, organization, place, concept, technology, tool, method mentioned
   - Abstract concepts, ideas, feelings, opinions, preferences
   - Temporal references (dates, events, periods)
   - Skills, experiences, achievements, goals
   - Objects, products, brands, services used or mentioned
   - Activities, hobbies, interests, projects

EXTRACTION GUIDELINES:
1. Extract ALL significant entities mentioned or implied
2. Focus on the core subject without descriptive wrapper text
3. For web content: Extract authors, companies, technologies, tools mentioned
4. For conversations: Extract speakers, topics, technologies discussed
5. Avoid extracting actions, relationships, or temporal information
6. Use full names when available, avoid pronouns and references
7. Include context in summary to disambiguate similar entities

Return a valid JSON array with this exact structure:
[
  {
    "name": "Clean Entity Name",
    "summary": "Brief description with context and relevance",
    "nodeType": "DESCRIPTIVE_CATEGORY_TYPE",
    "attributes": {}
  }
]

The nodeType should be a descriptive category that best represents what this entity is, following the naming conventions above.`;

const USER_INPUT_ENTITY_EXTRACTION_PROMPT = `You are an expert entity extraction specialist focused on PERSONAL KNOWLEDGE extraction. This content represents what a user wants to remember, so extract as much knowledge as possible to build a comprehensive personal knowledge graph.

CRITICAL USER INPUT HANDLING:
1. Convert first-person pronouns to represent the user:
   - "I", "me", "my", "myself" → "Memorall User"
   - Always create a "Memorall User" entity for user references
   - Use nodeType "USER" for the main user entity

2. Extract MAXIMUM entities - be extremely comprehensive:
   - Every person, organization, place, concept, technology, tool, method mentioned
   - Abstract concepts, ideas, feelings, opinions, preferences
   - Temporal references (dates, events, periods)
   - Skills, experiences, achievements, goals
   - Objects, products, brands, services used or mentioned
   - Activities, hobbies, interests, projects

PERSONAL KNOWLEDGE FOCUS:
- Treat this as building the user's personal knowledge base
- Extract entities that help understand the user's life, work, interests, and experiences
- Include subjective entities: preferences, opinions, feelings, attitudes
- Extract contextual entities: situations, environments, circumstances
- Be generous with entity extraction - err on the side of including more rather than less

EXTRACTION GUIDELINES:
1. Extract ALL entities - be maximally comprehensive
2. Always include "Memorall User" for any first-person references
3. Focus on building a rich personal knowledge graph
4. Include both concrete and abstract entities
5. Extract implicit entities (things implied but not directly stated)
6. Use descriptive summaries that capture personal context
7. Include emotional and subjective content as entities

Return a valid JSON array with this exact structure:
[
  {
    "name": "Clean Entity Name",
    "summary": "Brief description with personal context and relevance to the user",
    "nodeType": "DESCRIPTIVE_CATEGORY_TYPE",
    "attributes": {}
  }
]

REMEMBER: This is personal knowledge - extract comprehensively to build the user's complete knowledge graph!`;

const SPECIFIC_TEXT_CONVERSION_PROMPT = `You are an expert entity extraction specialist focused on MAXIMUM KNOWLEDGE EXTRACTION from user-selected text. The user has specifically selected this text to convert to knowledge, so extract EVERYTHING possible.

CRITICAL CONVERSION RULES:
1. Convert first-person pronouns to represent the user:
   - "I", "me", "my", "myself" → "Memorall User"
   - Always create a "Memorall User" entity for user references
   - Use nodeType "USER" for the main user entity

2. EXTRACT ABSOLUTELY EVERYTHING - Maximum Extraction Mode:
   - Every single person, organization, place, concept mentioned or implied
   - All technologies, tools, methods, frameworks, libraries, platforms
   - Abstract concepts, ideas, theories, principles, methodologies
   - Feelings, opinions, preferences, attitudes, beliefs, values
   - Temporal references (dates, times, events, periods, deadlines)
   - Skills, competencies, experiences, achievements, qualifications, goals
   - Objects, products, brands, services, features, capabilities
   - Activities, hobbies, interests, projects, tasks, responsibilities
   - Relationships, connections, influences, inspirations
   - Problems, challenges, solutions, approaches, strategies
   - Metrics, measurements, statistics, data points
   - Documents, resources, references, sources
   - Locations, venues, facilities, environments

3. AGGRESSIVE EXTRACTION STRATEGIES:
   - Extract implied entities (things mentioned indirectly)
   - Extract contextual entities (background information)
   - Extract related entities (associated concepts)
   - Extract metadata entities (source, author, date if mentioned)
   - Extract subjective entities (opinions, feelings, interpretations)
   - Extract process entities (methods, workflows, procedures)
   - Break down compound concepts into multiple entities
   - Extract entities from examples, analogies, and metaphors

4. QUALITY GUIDELINES:
   - Use clean, specific names without descriptive wrappers
   - Provide rich summaries with full context
   - Use specific, descriptive nodeTypes
   - Include all relevant attributes
   - Disambiguate similar entities with context in summary

Return a valid JSON array with this exact structure:
[
  {
    "name": "Clean Entity Name",
    "summary": "Comprehensive description with full context, relevance, and relationships",
    "nodeType": "SPECIFIC_DESCRIPTIVE_TYPE",
    "attributes": {"key": "value"}
  }
]

MAXIMIZE EXTRACTION - The user selected this text specifically to preserve knowledge. Extract everything that could be valuable!`;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function cleanEntityName(
	name: string,
	isUserInput: boolean,
	isSpecificConversion: boolean,
): string {
	let cleaned = name.trim();

	// Special handling for user input or specific conversion - convert first-person pronouns
	if (isUserInput || isSpecificConversion) {
		if (/^(i|me|my|myself)$/i.test(cleaned)) {
			return "Memorall User";
		}
		if (/^(my|mine)$/i.test(cleaned)) {
			return "Memorall User";
		}
	}

	// Remove common articles
	cleaned = cleaned.replace(/^(the|a|an)\s+/i, "");

	// Remove common descriptive patterns
	cleaned = cleaned.replace(/^\w+:?\s+/, "");

	// Remove introductory phrases pattern
	cleaned = cleaned.replace(/^(called|named|known\s+as):?\s+/i, "");

	// Generic URL cleaning
	if (
		cleaned.includes("://") ||
		cleaned.includes(".com") ||
		cleaned.includes(".org")
	) {
		try {
			const url = new URL(
				cleaned.startsWith("http") ? cleaned : `https://${cleaned}`,
			);
			const pathParts = url.pathname
				.split("/")
				.filter((part) => part.length > 0);

			if (pathParts.length >= 2) {
				cleaned = pathParts.slice(0, 2).join("/");
			} else if (pathParts.length === 1) {
				cleaned = pathParts[0];
			} else {
				cleaned = url.hostname.replace(/^www\./, "");
			}
		} catch {
			const domainMatch = cleaned.match(/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
			if (domainMatch) {
				cleaned = domainMatch[1].replace(/^www\./, "");
			}
		}
	}

	// Remove quotes and normalize whitespace
	cleaned = cleaned.replace(/^["']|["']$/g, "").trim();
	cleaned = cleaned.replace(/\s+/g, " ");

	return cleaned;
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	EntityExtractionInput,
	EntityExtractionOutput,
	AllServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			const llm = services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Determine which prompt to use based on context
			const isSpecificConversion = input.isSpecificTextConversion === true;
			const isUserInput = input.sourceType === "user_input";

			let promptToUse: string;
			let mode: string;

			if (isSpecificConversion) {
				promptToUse = SPECIFIC_TEXT_CONVERSION_PROMPT;
				mode = "SPECIFIC_TEXT_CONVERSION";
			} else if (isUserInput) {
				promptToUse = USER_INPUT_ENTITY_EXTRACTION_PROMPT;
				mode = "USER_INPUT";
			} else {
				promptToUse = ENTITY_EXTRACTION_SYSTEM_PROMPT;
				mode = "STANDARD";
			}

			logInfo(`[ENTITY_EXTRACTION] Starting entity extraction (${mode} mode)`);

			// Format content based on available information
			let formattedContent = `<CONTENT>\n${input.currentMessage}\n</CONTENT>`;

			if (input.previousMessages && input.previousMessages.trim().length > 0) {
				formattedContent = `<CONTEXT>\n${input.previousMessages}\n</CONTEXT>\n\n${formattedContent}`;
			}

			if (input.url || input.title) {
				const metadata = [];
				if (input.title) metadata.push(`Title: ${input.title}`);
				if (input.url) metadata.push(`Source: ${input.url}`);
				formattedContent = `<METADATA>\n${metadata.join("\n")}\n</METADATA>\n\n${formattedContent}`;
			}

			// Add special instruction based on mode
			if (isSpecificConversion) {
				formattedContent += `\n\n<INSTRUCTION>\nThe user specifically selected this text to convert to knowledge. Extract MAXIMUM entities - be extremely comprehensive. Convert "I/me/my" references to "Memorall User".\n</INSTRUCTION>`;
			} else if (isUserInput) {
				formattedContent += `\n\n<INSTRUCTION>\nThis is user input that the user wants to remember. Extract maximum knowledge and convert "I/me/my" references to "Memorall User".\n</INSTRUCTION>`;
			}

			interface ParsedEntity {
				name: string;
				summary?: string;
				nodeType?: string;
				attributes?: Record<string, unknown>;
			}

			const parseEntities = (content: string): ExtractedEntity[] => {
				let cleaned = content.trim();
				if (cleaned.startsWith("```json"))
					cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
				else if (cleaned.startsWith("```"))
					cleaned = cleaned.replace(/^```\s*/i, "").replace(/\s*```$/i, "");
				try {
					const parsed: unknown = JSON.parse(cleaned);
					if (Array.isArray(parsed)) {
						return parsed.map((e): ExtractedEntity => {
							const pe = e as ParsedEntity;
							const cleanedName = cleanEntityName(
								pe.name ?? "Unknown Entity",
								isUserInput,
								isSpecificConversion,
							);
							const nodeType = pe.nodeType?.toUpperCase() ?? "OTHER";

							return {
								uuid: crypto.randomUUID(),
								name: cleanedName,
								summary: pe.summary,
								nodeType,
								attributes: pe.attributes ?? {},
							};
						});
					}
				} catch {
					// Fallback basic regex extraction if JSON fails
					const matches =
						cleaned.match(/("name":\s*"[^"]+"|name:\s*[^\n,]+)/g) || [];
					return matches.map((m): ExtractedEntity => {
						const rawName = m
							.replace(/("name":\s*"|name:\s*)/, "")
							.replace(/"/g, "")
							.trim();
						const cleanedName = cleanEntityName(
							rawName,
							isUserInput,
							isSpecificConversion,
						);
						return {
							uuid: crypto.randomUUID(),
							name: cleanedName,
							summary: undefined,
							nodeType: "OTHER",
							attributes: {},
						};
					});
				}
				return [];
			};

			const maxModelTokens = await services.llm.getMaxModelTokens();
			const maxResponseTokens = await services.llm.getMaxModelTokens();

			const extractedEntities = await mapRefine<ExtractedEntity>(
				llm,
				promptToUse,
				(chunk, prev, errorContext) => {
					const prevNames = prev.map((p) => ` * ${p.name}`);
					let prompt = `<PREVIOUS RESULT>\n${prevNames.join("\n")}\n</PREVIOUS RESULT>\n<CHUNK>\n${chunk}\n</CHUNK>`;

					if (isUserInput) {
						prompt += `\n\nREMINDER: This is user input - extract maximum entities and convert "I/me/my" to "Memorall User".`;
					}

					if (errorContext) {
						const errorMsg = isUserInput
							? "Please fix the JSON format and ensure all entities are properly extracted. Remember to convert first-person pronouns to 'Memorall User'."
							: "Please fix the JSON format and ensure all entities are properly extracted.";
						prompt += `\n\n<ERROR_CONTEXT>\n${errorContext}\n${errorMsg}\n</ERROR_CONTEXT>`;
					}

					return prompt;
				},
				parseEntities,
				formattedContent,
				{
					maxModelTokens,
					maxResponseTokens,
					temperature: isUserInput ? 0.2 : 0.1,
					maxRetries: 2,
					dedupeBy: (e) => e.name.toLowerCase(),
					onError: (error, attempt) => {
						logError(
							`[ENTITY_EXTRACTION] Parse error on attempt ${attempt}:`,
							error,
						);
						if (
							error.message.includes("JSON") ||
							error.message.includes("parse")
						) {
							return `JSON parsing failed: ${error.message}. Please ensure the response is a valid JSON array with proper syntax and structure.`;
						}
						return `Processing failed on attempt ${attempt}: ${error.message}. Please retry with correct format.`;
					},
				},
			);

			logInfo("[ENTITY_EXTRACTION] Extracted entities:", extractedEntities);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Entity Extraction Complete",
					description: `Extracted ${extractedEntities.length} entities from content`,
					metadata: { entityCount: extractedEntities.length },
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					extractedEntities,
					processingStage: "entity_resolution",
				},
			};
		} catch (error) {
			logError("[ENTITY_EXTRACTION] Error:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Entity Extraction Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error ? error.message : "Entity extraction failed",
					],
				},
			};
		}
	},
});

type EntityExtractionSpec = StepSpecFromDefinition<typeof definition>;

export const createEntityExtractionStep: StepFactoryFromSpec<
	EntityExtractionSpec
> = (services: AllServices) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createEntityExtractionStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: EntityExtractionSpec;
	}
}
