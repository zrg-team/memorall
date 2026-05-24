import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type { ChatMessage } from "../../interfaces/messages";
import { AgentGraph } from "../../graph/agent";
import { logInfo } from "../../interfaces/logger";
import {
	isCustomChunkPayload,
	normalizeLangGraphStreamChunk,
} from "../../utils/langgraph-stream";
import { GraphBase, type GraphTool } from "../../graph/graph.base";

export const AGENT_COMPLETION_STEP_NAME = "agent-completion" as const;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface AgentCompletionStepInput {
	messages: ChatMessage[];
	maxIterations?: number;
	/**
	 * Tools accumulated in graph state by feature steps (e.g. fs-feature).
	 * These are merged with config.tools so both base tools and feature tools run.
	 */
	tools?: GraphTool[];
}

export interface AgentCompletionStepOutput {
	response: string;
}

export type AgentCompletionStepServices = AllServices;

export interface AgentCompletionStepConfig {
	/**
	 * Base tools always available to the agent regardless of feature steps.
	 * Merged (union) with input.tools at runtime.
	 */
	tools?: GraphTool[];
}

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	AgentCompletionStepInput,
	AgentCompletionStepOutput,
	AgentCompletionStepServices,
	AgentCompletionStepConfig
>({
	name: AGENT_COMPLETION_STEP_NAME,
	execute: async ({ input, services, runConfig, config }) => {
		logInfo("[AGENT_COMPLETION] Running agent completion");

		// Merge config base tools with state-accumulated feature tools.
		// Deduplicate so the same tool isn't registered twice in AgentGraph.
		const allTools = GraphBase.chat.addTool(
			[],
			...(config?.tools ?? []),
			...(input.tools ?? []),
		);

		const agentGraph = new AgentGraph(services, {
			tools: allTools.length > 0 ? allTools : undefined,
		});

		const stream = await agentGraph.stream(
			{
				messages: input.messages,
				maxIterations: input.maxIterations,
			},
			{
				configurable: runConfig?.configurable,
				streamMode: ["custom", "values"],
			},
		);

		let response = "";

		for await (const partial of stream) {
			const { mode, payload } = normalizeLangGraphStreamChunk(partial);

			if (mode === "custom" && isCustomChunkPayload(payload)) {
				runConfig?.writer?.(payload);
				continue;
			}

			if (mode === "values") {
				const stateValues = payload as Record<string, unknown>;
				if (stateValues?.response) {
					response = stateValues.response as string;
				}
			}
		}

		return { output: { response } };
	},
});

type AgentCompletionSpec = StepSpecFromDefinition<typeof definition>;

export const createAgentCompletionStep: StepFactoryFromSpec<
	AgentCompletionSpec
> = (
	services: AgentCompletionStepServices,
	config?: AgentCompletionStepConfig,
) => bindStep(definition, services, config);

stepRegistry.register(AGENT_COMPLETION_STEP_NAME, createAgentCompletionStep, {
	description: "Run an agentic tool-calling loop and produce a final response",
	configParams: [
		{
			key: "tools",
			type: "array",
			default: [],
			description: "Base tool names always available to the agent",
		},
	],
	defaultStateMapping: {
		messages: "messages",
		tools: "tools",
		maxIterations: "maxIterations",
	},
	enabledByDefault: true,
});

declare global {
	interface StepTypeRegistry {
		[AGENT_COMPLETION_STEP_NAME]: AgentCompletionSpec;
	}
}
