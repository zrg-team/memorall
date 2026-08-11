import { defineStep, bindStep } from "@/services/flows-legacy/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
	StepFactoryContext,
} from "@/services/flows-legacy/interfaces/engine/step";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import {
	GraphBase,
	type ConfiguredGraphTool,
	type GraphTool,
} from "@/services/flows-legacy/graph/graph.base";
import { stepRegistry } from "@/services/flows-legacy/registries/step-registry";
import {
	MultiAgentManager,
	type MultiAgentChildAgent,
} from "@/services/flows-legacy/steps/features/multi-agent-feature/conversation-manager";
import {
	SEND_MESSAGE_TO_AGENT_TOOL_NAME,
	type SendMessageToAgentToolConfig,
} from "@/services/flows-legacy/steps/features/multi-agent-feature/tool-contract";
import type { ChatCompletionMessageParam } from "@/services/flows-legacy/interfaces/engine/messages";
import { logError } from "@/services/flows-legacy/utils/logger";

const STEP_NAME = "multi-agent-feature" as const;
export const MULTI_AGENT_FEATURE_NAME = STEP_NAME;

export interface MultiAgentFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
	topicId?: string;
}

export interface MultiAgentFeatureOutput {
	messages?: ChatCompletionMessageParam[];
	tools?: GraphTool[];
}

export interface MultiAgentFeatureConfig {
	accessibleAgentIds?: string[];
}

export type MultiAgentFeatureServices = AllServices;

export const MULTI_AGENT_FEATURE_TOOLS = [
	SEND_MESSAGE_TO_AGENT_TOOL_NAME,
] as const;

export const MULTI_AGENT_FEATURE_DESCRIPTION =
	"Allow this agent to send focused messages to selected child agents with per-agent in-memory conversation history.";

const SYSTEM_PROMPT_INSTRUCTION = `
# MULTI-AGENT DELEGATION
You can collaborate with selected child agents by using the \`send_message_to_agent\` tool.

## DELEGATION RULES
- Use child agents only for focused subtasks, not the full user requirement.
- Pick the child agent whose name and description best match the subtask.
- Each child agent keeps its own conversation history during the current run.
- Continue a child conversation by calling \`send_message_to_agent\` again for the same child agent.
- Keep each message specific and scoped. Do not dump the entire task into the child agent.
- Use the child agent's response as working material for the parent task.
`;

export const MULTI_AGENT_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

const normalizeAccessibleAgentIds = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter(isNonEmptyString) : [];

const formatAllowedAgents = (agents: MultiAgentChildAgent[]): string => {
	if (agents.length === 0) {
		return "No child agents are currently available.";
	}

	return [
		"## ALLOWED CHILD AGENTS",
		...agents.map((agent, index) =>
			[
				`Agent ${index + 1}:`,
				`- id: ${agent.id}`,
				`- name: ${agent.name}`,
				`- description: ${agent.description?.trim() || "(no description)"}`,
			].join("\n"),
		),
	].join("\n\n");
};

const definition = defineStep<
	MultiAgentFeatureInput,
	MultiAgentFeatureOutput,
	MultiAgentFeatureServices,
	MultiAgentFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config, runLifecycle, services, registries }) => {
		try {
			const configuredIds = normalizeAccessibleAgentIds(
				config?.accessibleAgentIds,
			);
			if (configuredIds.length === 0) {
				return {
					output: {
						messages: input.messages,
						tools: input.tools,
					},
				};
			}

			const flows = (await services.flowCatalog?.listFlows("foundation")) ?? [];
			const allowedAgents = flows
				.filter((flow) => configuredIds.includes(flow.id))
				.map((flow) => ({
					id: flow.id,
					name: flow.name,
					description: flow.description,
				}));

			if (allowedAgents.length === 0) {
				return {
					output: {
						messages: input.messages,
						tools: input.tools,
					},
				};
			}

			const multiAgentManager = MultiAgentManager.fromFeatureInput(
				input,
				allowedAgents,
				services,
				registries,
			);
			runLifecycle?.onFinish("multi-agent-feature-manager", async () => {
				multiAgentManager.dispose();
			});

			const configuredTool: ConfiguredGraphTool<SendMessageToAgentToolConfig> =
				{
					name: SEND_MESSAGE_TO_AGENT_TOOL_NAME,
					config: {
						multiAgentManager,
					},
				};

			return {
				output: {
					messages: GraphBase.chat.systemMessage(
						input.messages,
						`${MULTI_AGENT_FEATURE_SYSTEM_PROMPT}\n\n${formatAllowedAgents(allowedAgents)}`,
					),
					tools: GraphBase.chat.addTool(input.tools, configuredTool),
				},
			};
		} catch (error) {
			logError("[MULTI_AGENT_FEATURE_V1] Failed:", error);
			return {
				output: {
					messages: input.messages,
					tools: input.tools,
				},
			};
		}
	},
});

type MultiAgentFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createMultiAgentFeatureStep: StepFactoryFromSpec<
	MultiAgentFeatureSpec
> = (
	services: MultiAgentFeatureServices,
	config?: MultiAgentFeatureConfig,
	context?: StepFactoryContext,
) => bindStep(definition, services, config, context);

stepRegistry.register(STEP_NAME, createMultiAgentFeatureStep, {
	description: MULTI_AGENT_FEATURE_DESCRIPTION,
	configParams: [
		{
			key: "accessibleAgentIds",
			type: "array",
			default: [],
			description: "Predefined child agent flow IDs that this agent may access",
		},
	],
	defaultStateMapping: {
		messages: "messages",
		tools: "tools",
		topicId: "graphId",
	},
	enabledByDefault: false,
	feature: {
		id: "step-multi-agent-feature",
		type: "feature",
		graphTypes: ["foundation"],
		inputs: [
			{
				name: "messages",
				type: "Message[]",
				required: true,
				description: "Current chat messages",
			},
			{
				name: "tools",
				type: "Tool[]",
				required: true,
				description: "Current available tools",
			},
			{
				name: "topicId",
				type: "string",
				required: false,
				description: "Current topic ID passed to delegated child agents",
			},
		],
		outputs: [
			{
				name: "messages",
				type: "Message[]",
				description: "Messages with multi-agent delegation instructions.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with configured child-agent delegation.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: MultiAgentFeatureSpec;
	}
}
