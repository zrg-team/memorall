import { logInfo, logError } from "../../interfaces/logger";

import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type {
	ChatCompletionResponse,
	ChatMessage,
} from "../../interfaces/messages";

const STEP_NAME = "analyze-query" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export type QueryIntent =
	| "factual"
	| "relationship"
	| "summary"
	| "exploration";

export interface AnalyzeQueryInput {
	query: string;
}

export interface AnalyzeQueryOutput {
	extractedEntities?: string[];
	queryIntent?: QueryIntent;
	next?: string;
	errors?: string[];
}

export type AnalyzeQueryServices = Pick<AllServices, "llm">;

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const QUERY_ANALYSIS_PROMPT = `
You are an expert at analyzing user queries for knowledge graph retrieval.

Analyze the user query and extract:
1. Key entities mentioned (people, places, concepts, organizations)
2. Query intent: "factual" (seeking facts), "relationship" (asking about connections), "summary" (wanting overview), "exploration" (browsing/discovery)

User Query: {query}

Respond in this exact JSON format:
{
  "entities": ["entity1", "entity2"],
  "intent": "factual|relationship|summary|exploration"
}
`;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	AnalyzeQueryInput,
	AnalyzeQueryOutput,
	AnalyzeQueryServices
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		const llm = services.llm;

		if (!llm.isReady()) {
			throw new Error("LLM service is not ready");
		}

		try {
			logInfo("[ANALYZE_QUERY] Analyzing query:", input.query);

			// WebLLM requires last message to be from user or tool role
			const messages: ChatMessage[] = [
				{ role: "system", content: QUERY_ANALYSIS_PROMPT },
				{ role: "user", content: input.query },
			];

			const llmResponse = (await llm.chatCompletions({
				messages,
				temperature: 0.1,
				stream: false,
			})) as ChatCompletionResponse;

			const responseContent = llmResponse.choices[0].message.content || "";

			// Parse JSON response
			let analysisResult: { entities: string[]; intent: string } | undefined;
			try {
				const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					analysisResult = JSON.parse(jsonMatch[0]);
				} else {
					throw new Error("No JSON found in response");
				}
			} catch (parseError) {
				logError(
					"[ANALYZE_QUERY] Failed to parse analysis response:",
					parseError,
				);
				// Fallback to simple entity extraction
				analysisResult = {
					entities: input.query.split(" ").filter((word) => word.length > 3),
					intent: "factual",
				};
			}

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Query Analysis Complete",
					description: `Extracted ${analysisResult?.entities?.length || 0} entities: ${analysisResult?.entities?.map((e) => `"${e}"`).join(", ") || "none"} with "${analysisResult?.intent}" intent`,
					metadata: {
						entities: analysisResult?.entities,
						intent: analysisResult?.intent,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					extractedEntities: analysisResult?.entities || [],
					queryIntent: (analysisResult?.intent || "factual") as QueryIntent,
					next: "retrieve_knowledge",
				},
			};
		} catch (error) {
			logError("[ANALYZE_QUERY] Query analysis failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Query Analysis Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					errors: [
						error instanceof Error ? error.message : "Query analysis failed",
					],
				},
			};
		}
	},
});

type AnalyzeQuerySpec = StepSpecFromDefinition<typeof definition>;

export const createAnalyzeQueryStep: StepFactoryFromSpec<AnalyzeQuerySpec> = (
	services: AnalyzeQueryServices,
) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createAnalyzeQueryStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: AnalyzeQuerySpec;
	}
}
