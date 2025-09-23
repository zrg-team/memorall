import type { KnowledgeGraphState, ExtractedEntity } from "./state";
import type { AllServices } from "../../interfaces/tool";
import { logInfo, logError } from "@/utils/logger";
import { mapRefine } from "../../../../utils/map-refine";

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are an expert entity extraction specialist. Extract clean, precise entity nodes from the provided CONTENT.

CRITICAL NAMING RULES:
1. Entity names MUST be clean, pure identifiers without any descriptive wrapper text
   ❌ Bad: "the company Apple", "a person named John", "repository called MyProject"
   ✅ Good: "Apple", "John Smith", "MyProject"

2. Extract only the core subject name by removing:
   - Articles: "the", "a", "an"
   - Descriptive prefixes that classify the entity type
   - Introductory phrases like "named", "called", "known as"
   - Any wrapper text that describes what something is rather than what it's called

3. Focus on the canonical identifier:
   - Use the most recognized, official name for the entity
   - Strip away legal suffixes unless they're part of the common identity
   - Prefer complete names over abbreviations when the full form is more recognizable
   - Maintain standard formatting for technical names and identifiers
   - For URLs or paths, extract the meaningful identifier portion

NODE TYPE GUIDELINES:
- Create descriptive, specific node types that best categorize each entity
- Use UPPERCASE with underscores for consistency (e.g., "PROGRAMMING_LANGUAGE", "RESEARCH_PAPER")
- Be as specific as possible while keeping types reusable across similar entities
- Examples of good node types:
  * For people: PERSON, AUTHOR, RESEARCHER, CEO, DEVELOPER
  * For organizations: COMPANY, UNIVERSITY, GOVERNMENT_AGENCY, NONPROFIT
  * For technology: PROGRAMMING_LANGUAGE, FRAMEWORK, DATABASE, PROTOCOL
  * For content: ARTICLE, DOCUMENTATION, VIDEO, PODCAST, BLOG_POST
  * For concepts: METHODOLOGY, ALGORITHM, BUSINESS_MODEL, DESIGN_PATTERN
  * For locations: CITY, COUNTRY, BUILDING, VENUE
  * For events: CONFERENCE, PRODUCT_LAUNCH, MERGER, ACQUISITION
- Create new types as needed - don't force entities into existing categories
- The type should clearly indicate what category or nature the entity represents

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

SPECIAL ENTITY TYPES FOR USER INPUT:
- USER: The memorall user (for "I", "me", "my" references)
- PREFERENCE: Things the user likes/dislikes
- EXPERIENCE: User's experiences or events they participated in
- SKILL: Abilities, competencies, knowledge areas
- GOAL: Objectives, aspirations, targets
- OPINION: User's views, thoughts, beliefs
- MEMORY: Specific memories or recollections
- RELATIONSHIP: Connections with other people

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

export class EntityExtractionFlow {
	constructor(private services: AllServices) {}

	async extractEntities(
		state: KnowledgeGraphState,
	): Promise<Partial<KnowledgeGraphState>> {
		try {
			const llm = this.services.llm;

			if (!llm.isReady()) {
				throw new Error("LLM service is not ready");
			}

			// Determine if this is user input that should be remembered
			const isUserInput = state.sourceType === "user_input";
			const promptToUse = isUserInput ? USER_INPUT_ENTITY_EXTRACTION_PROMPT : ENTITY_EXTRACTION_SYSTEM_PROMPT;

			logInfo(`[ENTITY_EXTRACTION] Starting entity extraction (${isUserInput ? 'USER_INPUT' : 'STANDARD'} mode)`);

			// Format content based on available information
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

			// Add special instruction for user input
			if (isUserInput) {
				formattedContent += `\n\n<INSTRUCTION>\nThis is user input that the user wants to remember. Extract maximum knowledge and convert "I/me/my" references to "Memorall User".\n</INSTRUCTION>`;
			}

			interface ParsedEntity {
				name: string;
				summary?: string;
				nodeType?: string;
				attributes?: Record<string, unknown>;
			}

			const cleanEntityName = (name: string): string => {
				let cleaned = name.trim();

				// Special handling for user input - convert first-person pronouns
				if (isUserInput) {
					// Convert first-person pronouns to "Memorall User"
					if (/^(i|me|my|myself)$/i.test(cleaned)) {
						return "Memorall User";
					}
					// Handle possessive forms
					if (/^(my|mine)$/i.test(cleaned)) {
						return "Memorall User";
					}
				}

				// Generic pattern-based cleaning without fixed lists
				// Remove common articles
				cleaned = cleaned.replace(/^(the|a|an)\s+/i, "");

				// Remove common descriptive patterns (word + colon/space + actual name)
				cleaned = cleaned.replace(/^\w+:?\s+/, "");

				// Remove introductory phrases pattern
				cleaned = cleaned.replace(/^(called|named|known\s+as):?\s+/i, "");

				// Generic URL cleaning - extract meaningful identifiers from URLs
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
							// Use meaningful path structure (e.g., user/repo)
							cleaned = pathParts.slice(0, 2).join("/");
						} else if (pathParts.length === 1) {
							cleaned = pathParts[0];
						} else {
							// Use clean domain name
							cleaned = url.hostname.replace(/^www\./, "");
						}
					} catch {
						// If URL parsing fails, try simple domain extraction
						const domainMatch = cleaned.match(/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
						if (domainMatch) {
							cleaned = domainMatch[1].replace(/^www\./, "");
						}
					}
				}

				// Remove quotes and normalize whitespace
				cleaned = cleaned.replace(/^["']|["']$/g, "").trim();

				// Remove extra whitespace
				cleaned = cleaned.replace(/\s+/g, " ");

				return cleaned;
			};

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
							const cleanedName = cleanEntityName(pe.name ?? "Unknown Entity");
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
						const cleanedName = cleanEntityName(rawName);
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
					maxModelTokens: 10000,
					maxResponseTokens: 4096,
					temperature: isUserInput ? 0.2 : 0.1, // Higher creativity for user input
					maxRetries: 2,
					dedupeBy: (e) => e.name.toLowerCase(),
					onError: (error, attempt, chunk) => {
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

			return {
				extractedEntities,
				processingStage: "entity_resolution",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Entity Extraction Complete",
						description: `Extracted ${extractedEntities.length} entities from content`,
						metadata: { entityCount: extractedEntities.length },
					},
				],
			};
		} catch (error) {
			logError("[ENTITY_EXTRACTION] Error:", error);

			return {
				errors: [
					error instanceof Error ? error.message : "Entity extraction failed",
				],
				actions: [
					{
						id: crypto.randomUUID(),
						name: "Entity Extraction Failed",
						description:
							error instanceof Error ? error.message : "Unknown error",
						metadata: {},
					},
				],
			};
		}
	}
}
