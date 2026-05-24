/**
 * Context Retrieve Knowledge Step
 *
 * Combines analyze-query, llm-retrieve and entities-facts-to-context into a single step.
 * Output: "context" string ready for LLM consumption, plus relevantNodes/relevantEdges for citation.
 */

import { logInfo, logError } from "../../interfaces/logger";
import { defineStep, bindStep, type StepOutput } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type {
	LLMRetrieveInput,
	LLMRetrieveOutput,
	RelevantNode,
	RelevantEdge,
	LLMRetrieveServices,
} from "../knowledge-retrieval/llm-retrieve";
import type { AnalyzeQueryOutput } from "../knowledge-retrieval/analyze-query";
import type {
	EntitiesFactsToContextOutput,
	EntitiesFactsToContextServices,
} from "../knowledge-retrieval/entities-facts-to-context";
import type {
	ContextToSystemConfig,
	ContextToSystemInput,
	ContextToSystemOutput,
} from "../common/context-to-system";
import type { ChatCompletionMessageParam } from "../../interfaces/messages";
import { extractRetrievalTextFromMessages } from "../../utils/message-query";

const STEP_NAME = "context-llm-retrieve" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ContextLLMRetrieveInput
	extends LLMRetrieveInput,
		ContextToSystemInput {}

export interface ContextLLMRetrieveOutput
	extends LLMRetrieveOutput,
		ContextToSystemOutput {
	context: string;
}

export interface ContextLLMRetrieveConfig extends ContextToSystemConfig {}

export type ContextLLMRetrieveServices = LLMRetrieveServices &
	EntitiesFactsToContextServices;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	ContextLLMRetrieveInput,
	ContextLLMRetrieveOutput,
	ContextLLMRetrieveServices,
	ContextLLMRetrieveConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			logInfo(
				`[CONTEXT_RETRIEVE_KNOWLEDGE] Starting for graphId: ${input.graphId}`,
			);
			const query = extractRetrievalTextFromMessages(input.messages);

			// Step 1: Analyze query to extract entities
			const analyzeQueryStep = stepRegistry.getStepByName(
				"analyze-query",
				services,
			);
			const analyzeResult = (await analyzeQueryStep.execute(
				{
					query,
				},
				runConfig,
			)) as StepOutput<AnalyzeQueryOutput>;

			if (analyzeResult.output.errors?.length) {
				return {
					output: {
						context: "",
						errors: analyzeResult.output.errors,
					},
				};
			}

			const extractedEntities = analyzeResult.output.extractedEntities ?? [];

			// Step 2: Run llm-retrieve
			const retrieveLLMStep = stepRegistry.getStepByName(
				"llm-retrieve",
				services,
			);
			const retrieveResult = (await retrieveLLMStep.execute(
				{
					extractedEntities,
					graphId: input.graphId,
				},
				runConfig,
			)) as StepOutput<LLMRetrieveOutput>;

			if (retrieveResult.output.errors?.length) {
				return {
					output: {
						context: "",
						errors: retrieveResult.output.errors,
					},
				};
			}

			const relevantNodes = retrieveResult.output.relevantNodes ?? [];
			const relevantEdges = retrieveResult.output.relevantEdges ?? [];

			// Step 3: Build context
			const buildContextStep = stepRegistry.getStepByName(
				"entities-facts-to-context",
				{},
			);
			const contextResult = (await buildContextStep.execute(
				{
					relevantNodes,
					relevantEdges,
					graphId: input.graphId,
				},
				runConfig,
			)) as StepOutput<EntitiesFactsToContextOutput>;

			const context = contextResult.output.knowledgeContext ?? "";

			logInfo(
				`[CONTEXT_RETRIEVE_KNOWLEDGE] Complete: ${relevantNodes.length} nodes, ${relevantEdges.length} edges`,
			);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Context Retrieve Knowledge Complete",
					description: `Built context from ${relevantNodes.length} nodes and ${relevantEdges.length} edges`,
					metadata: {
						nodeCount: relevantNodes.length,
						edgeCount: relevantEdges.length,
					},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			const contextToSystem = stepRegistry.getStepByName<
				ContextToSystemInput,
				ContextToSystemOutput
			>("context-to-system", services, {
				prompt: config?.prompt,
			});

			const contextToSystemResult = await contextToSystem.execute(
				{
					context,
					messages: input.messages,
				},
				runConfig,
			);

			return {
				output: {
					context,
					relevantNodes,
					relevantEdges,
					nodeCount: relevantNodes.length,
					edgeCount: relevantEdges.length,
					messages: contextToSystemResult.output.messages,
				},
			};
		} catch (error) {
			logError("[CONTEXT_RETRIEVE_KNOWLEDGE] Failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Context Retrieve Knowledge Failed",
					description: error instanceof Error ? error.message : "Unknown error",
					metadata: {},
				},
			];
			runConfig?.writer?.({ type: "actions", actions });

			return {
				output: {
					context: "",
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Context retrieve knowledge failed",
					],
				},
			};
		}
	},
});

type ContextLLMRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createContextLLMRetrieveStep: StepFactoryFromSpec<
	ContextLLMRetrieveSpec
> = (services: ContextLLMRetrieveServices, config?: ContextLLMRetrieveConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createContextLLMRetrieveStep, {
	description:
		"LLM-guided entity extraction + graph traversal retrieval (high accuracy, slower)",
	defaultStateMapping: {
		messages: "messages",
		graphId: "graphId",
	},
	enabledByDefault: false,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ContextLLMRetrieveSpec;
	}
}
