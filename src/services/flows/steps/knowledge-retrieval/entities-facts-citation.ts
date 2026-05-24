import { logInfo, logError } from "../../interfaces/logger";

import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type { ChatMessage } from "../../interfaces/messages";

const STEP_NAME = "entities-facts-citation" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface EntitiesFactsCitationInput {
	// Knowledge Retrieval
	relevantNodes: Array<{
		id: string;
		nodeType: string;
		name: string;
		summary: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;

	relevantEdges: Array<{
		id: string;
		sourceId: string;
		destinationId: string;
		edgeType: string;
		factText: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;
	response?: string;
}

export interface EntitiesFactsCitationOutput {
	response?: string;
	errors?: string[];
}

export type EntitiesFactsCitationServices = Pick<AllServices, "llm">;
export type EntitiesFactsCitationConfig = {};

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const CITATION_PROMPT = `
You are tasked with identifying which knowledge sources were used in each line of an answer.

Answer with Line Numbers:
{answer}

Knowledge Sources Available:
{sources}

Instructions:
1. For each line that uses knowledge sources, identify which nodes and edges were used
2. Return ONLY line numbers with their citations in this exact format:
   Line X: [Label](#citations:node/{uuid}), [Label](#citation:edge/{uuid})
3. Use actual UUIDs from the knowledge sources list
4. Only include lines that need citations - skip lines that don't use knowledge sources
5. CRITICAL: For nodes, the link MUST start with "#": [Label](#citations:node/{uuid})
6. CRITICAL: For edges, the link MUST start with "#": [Label](#citation:edge/{uuid})
7. IMPORTANT: The "#" symbol at the start of the link is REQUIRED - DO NOT omit it
8. IMPORTANT: DO NOT add citations to table rows (lines starting with "|") - tables should remain citation-free
9. IMPORTANT: DO NOT add citations to table separator lines (lines with "---" or "|---|")
10. IMPORTANT: For tables, add citations on the line AFTER the table ends (after the last row)
11. Do not include any explanation or the original text - ONLY line numbers and citations

Example format (notice the "#" at the start of each link):
Line 1: [React](#citations:node/abc-123)
Line 3: [uses](#citation:edge/def-456), [JavaScript](#citations:node/ghi-789)

Example for tables:
Line 15: [Table Data](#citations:node/abc-123), [Source](#citation:edge/def-456)
(Where line 15 is the line AFTER the table ends, not the table rows themselves)

REMINDER:
- Every citation link MUST start with "#" - this is mandatory!
- Skip all table lines (any line containing "|" for table formatting)
- Cite tables on the line immediately after the table ends
`;

const definition = defineStep<
	EntitiesFactsCitationInput,
	EntitiesFactsCitationOutput,
	EntitiesFactsCitationServices,
	EntitiesFactsCitationConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		const llm = services.llm;

		if (
			!input.response?.trim() ||
			(!input.relevantNodes?.length && !input.relevantEdges?.length) ||
			!llm.isReady()
		) {
			return {
				output: {
					response: input.response,
				},
			};
		}

		try {
			logInfo("[FOUNDATION] Adding citations to response");

			// Split answer into lines and number them
			const answerLines = (input.response || "").split("\n");
			const numberedAnswer = answerLines
				.map((line, index) => `Line ${index + 1}: ${line}`)
				.join("\n");

			// Build sources list using actual UUIDs
			const sourcesList = [
				"Nodes:",
				...input.relevantNodes.map(
					(node) => `- ${node.name} (UUID: ${node.id})`,
				),
				"",
				"Edges:",
				...input.relevantEdges.map(
					(edge) => `- ${edge.edgeType}: ${edge.factText} (UUID: ${edge.id})`,
				),
			].join("\n");

			// Build system message with citation instructions
			const systemMessage: ChatMessage = {
				role: "system",
				content: CITATION_PROMPT.replace("{answer}", numberedAnswer).replace(
					"{sources}",
					sourcesList,
				),
			};

			// Use minimal messages for citation task
			const messages: ChatMessage[] = [
				systemMessage,
				{
					role: "user",
					content:
						"Identify citations for each line that uses knowledge sources.",
				},
			];

			// NO STREAMING - just get the citations directly
			const llmResponse = await llm.chatCompletions({
				messages,
				temperature: 0.1,
				stream: false,
			});

			const citationResponse =
				"choices" in llmResponse
					? llmResponse.choices[0].message.content || ""
					: "";

			// Parse line-based citations
			// Format: "Line X: [Label](#citations:node/uuid), [Label](#citation:edge/uuid)"
			const lineCitations = new Map<number, string>();
			const linePattern = /Line\s+(\d+):\s*(.+?)(?=\n|$)/gi;
			let match;

			while ((match = linePattern.exec(citationResponse)) !== null) {
				const lineNum = parseInt(match[1], 10);
				const citations = match[2].trim();
				lineCitations.set(lineNum, citations);
			}

			// Merge citations back into original answer
			const citedLines = answerLines.map((line, index) => {
				const lineNum = index + 1;
				const citations = lineCitations.get(lineNum);
				if (citations) {
					// Add citations at the end of the line
					return `${line} ${citations}`;
				}
				return line;
			});

			const citedResponse = citedLines.join("\n");

			return {
				output: {
					response: citedResponse,
				},
			};
		} catch (error) {
			logError("[FOUNDATION] Citation failed:", error);

			return {
				output: {
					response: input.response,
				},
			};
		}
	},
});

type EntitiesFactsCitationSpec = StepSpecFromDefinition<typeof definition>;

export const createEntitiesFactsCitationStep: StepFactoryFromSpec<
	EntitiesFactsCitationSpec
> = (services, config) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createEntitiesFactsCitationStep, {
	description: "Append knowledge-graph citations to the final response",
	defaultStateMapping: {
		messages: "messages",
		relevantNodes: "relevantNodes",
		relevantEdges: "relevantEdges",
		response: "response",
	},
	enabledByDefault: false,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: EntitiesFactsCitationSpec;
	}
}
