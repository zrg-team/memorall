/**
 * Context Quick Retrieve Step
 *
 * Combines quick-retrieve and build-context into a single step.
 * Output: "context" string ready for LLM consumption.
 */

import { logInfo, logError } from "../../interfaces/logger";
import { defineStep, bindStep, type StepOutput } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type {
	QuickRetrieveInput,
	QuickRetrieveOutput,
	QuickRetrieveSerices,
	QuickRetrieveConfig,
} from "../knowledge-retrieval/quick-retrieve";
import type {
	EntitiesFactsToContextOutput,
	EntitiesFactsToContextServices,
} from "../knowledge-retrieval/entities-facts-to-context";
import { extractRetrievalTextFromMessages } from "../../utils/message-query";
import type {
	ContextToSystemConfig,
	ContextToSystemInput,
	ContextToSystemOutput,
} from "../common/context-to-system";

const STEP_NAME = "context-quick-retrieve" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ContextQuickRetrieveInput
	extends ContextToSystemInput,
		QuickRetrieveInput {}

export interface ContextQuickRetrieveOutput
	extends ContextToSystemOutput,
		QuickRetrieveOutput {
	context: string;
}

export interface ContextQuickRetrieveConfig
	extends ContextToSystemConfig,
		QuickRetrieveConfig {}

export type ContextQuickRetrieveServices = QuickRetrieveSerices &
	EntitiesFactsToContextServices;

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	ContextQuickRetrieveInput,
	ContextQuickRetrieveOutput,
	ContextQuickRetrieveServices,
	ContextQuickRetrieveConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			logInfo(
				`[CONTEXT_QUICK_RETRIEVE] Starting for graphId: ${input.graphId}`,
			);
			const query = extractRetrievalTextFromMessages(input.messages);

			// Step 1: Run quick-retrieve
			// Use getStepByName to avoid circular type reference
			const quickRetrieveStep = stepRegistry.getStepByName(
				"quick-retrieve",
				services,
				{
					maxGrowthLevels: config?.maxGrowthLevels,
					searchLimit: config?.searchLimit,
				},
			);
			const retrieveResult = (await quickRetrieveStep.execute(
				{
					query,
					graphId: input.graphId,
				},
				runConfig,
			)) as StepOutput<QuickRetrieveOutput>;

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
				`[CONTEXT_QUICK_RETRIEVE] Complete: ${relevantNodes.length} nodes, ${relevantEdges.length} edges`,
			);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Context Quick Retrieve Complete",
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
			logError("[CONTEXT_QUICK_RETRIEVE] Failed:", error);

			const actions = [
				{
					id: crypto.randomUUID(),
					name: "Context Quick Retrieve Failed",
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
							: "Context quick retrieve failed",
					],
				},
			};
		}
	},
});

type ContextQuickRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createContextQuickRetrieveStep: StepFactoryFromSpec<
	ContextQuickRetrieveSpec
> = (
	services: ContextQuickRetrieveServices,
	config?: ContextQuickRetrieveConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createContextQuickRetrieveStep, {
	description: "Fast semantic-search + graph-growth retrieval",
	configParams: [
		{
			key: "maxGrowthLevels",
			type: "number",
			default: 2,
			description: "Graph expansion depth from seed nodes",
		},
		{
			key: "searchLimit",
			type: "number",
			default: 10,
			description: "Maximum number of seed nodes returned by semantic search",
		},
	],
	defaultStateMapping: {
		messages: "messages",
		graphId: "graphId",
	},
	enabledByDefault: false,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ContextQuickRetrieveSpec;
	}
}
