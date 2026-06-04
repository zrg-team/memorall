/**
 * Context Smart Retrieve Step
 *
 * Combines smart-retrieve and build-context into a single step.
 * Output: "context" string ready for LLM consumption.
 */

import { Annotation } from "@langchain/langgraph";
import type { RetrievalPipelineState } from "flow-memory/interfaces/retrieval-state";
import { logInfo, logError } from "flow-core/utils/logger";
import {
	defineStep,
	bindStep,
	type StepOutput,
} from "flow-core/interfaces/engine/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { stepRegistry } from "flow-core/registries/step-registry";
import type {
	SmartRetrieveOutput,
	SmartRetrieveServices,
	SmartRetrieveInput,
	SmartRetrievalConfig,
} from "../knowledge-retrieval/smart-retrieve";
import type { EntitiesFactsToContextOutput } from "../knowledge-retrieval/entities-facts-to-context";
import { extractRetrievalTextFromMessages } from "flow-core/utils/message-query";
import type {
	ContextToSystemConfig,
	ContextToSystemInput,
	ContextToSystemOutput,
} from "flow-core/steps/common/context-to-system";

const STEP_NAME = "context-smart-retrieve" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ContextSmartRetrieveInput
	extends SmartRetrieveInput,
		ContextToSystemInput {}

export interface ContextSmartRetrieveOutput
	extends SmartRetrieveOutput,
		ContextToSystemOutput {
	context: string;
}

export interface ContextSmartRetrieveConfig
	extends SmartRetrievalConfig,
		ContextToSystemConfig {}

export type ContextSmartRetrieveServices = SmartRetrieveServices;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	ContextSmartRetrieveInput,
	ContextSmartRetrieveOutput,
	ContextSmartRetrieveServices,
	ContextSmartRetrieveConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig, registries }) => {
		try {
			logInfo(
				`[CONTEXT_SMART_RETRIEVE] Starting for graphId: ${input.graphId}`,
			);
			const steps = registries?.steps ?? stepRegistry;
			const query = extractRetrievalTextFromMessages(input.messages);

			// Step 1: Run smart-retrieve
			// Use getStepByName to avoid circular type reference
			const smartRetrieveStep = steps.getStepByName("smart-retrieve", services);
			const retrieveResult = (await smartRetrieveStep.execute(
				{
					query,
					graphId: input.graphId,
					contextQueries: input.contextQueries,
				},
				runConfig,
			)) as StepOutput<SmartRetrieveOutput>;

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

			// Step 2: Build context
			// Use getStepByName to avoid circular type reference
			const buildContextStep = steps.getStepByName(
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
				`[CONTEXT_SMART_RETRIEVE] Complete: ${relevantNodes.length} nodes, ${relevantEdges.length} edges`,
			);

			const contextToSystem = steps.getStepByName<
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
			logError("[CONTEXT_SMART_RETRIEVE] Failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Context Smart Retrieve Failed",
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
							: "Context smart retrieve failed",
					],
				},
			};
		}
	},
});

type ContextSmartRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createContextSmartRetrieveStep: StepFactoryFromSpec<
	ContextSmartRetrieveSpec
> = (
	services: ContextSmartRetrieveServices,
	config?: ContextSmartRetrieveConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createContextSmartRetrieveStep, {
	description:
		"Hybrid semantic-search + graph-expansion retrieval (recommended default)",
	defaultStateMapping: {
		messages: "messages",
		graphId: "graphId",
		contextQueries: "contextQueries",
	},
	enabledByDefault: true,
	stateAnnotation: {
		context: Annotation<string>({
			value: (x, y) => y ?? x ?? "",
			default: () => "",
		}),
		relevantNodes: Annotation<RetrievalPipelineState["relevantNodes"]>({
			value: (x, y) => y ?? x ?? [],
			default: () => [],
		}),
		relevantEdges: Annotation<RetrievalPipelineState["relevantEdges"]>({
			value: (x, y) => y ?? x ?? [],
			default: () => [],
		}),
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ContextSmartRetrieveSpec;
	}
}
