import { serviceManager } from "@/services";
import {
	type ConfiguredGraphTool,
	GraphBase,
	type GraphTool,
} from "../../../graph/graph.base";
import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import type { AllServices } from "../../../interfaces/tool";
import { stepRegistry } from "../../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import {
	MultiAgentManager,
	type MultiAgentChildAgent,
} from "./conversation-manager";
import {
	SEND_MESSAGE_TO_AGENT_TOOL_NAME,
	type SendMessageToAgentToolConfig,
} from "./tool-contract";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import { logError } from "../../../interfaces/logger";

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
	execute: async ({ input, config, runLifecycle, services }) => {
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

			const flows =
				await serviceManager.flowBuilderService.listPredefinedFlows(
					"foundation",
				);
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
> = (services: MultiAgentFeatureServices, config?: MultiAgentFeatureConfig) =>
	bindStep(definition, services, config);

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
});

featureCatalogRegistry.register({
	id: "step-multi-agent-feature",
	name: MULTI_AGENT_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: [
		...FEATURE_DEFAULT_INPUTS,
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
	metadata: {
		description: MULTI_AGENT_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.multiAgentFeature.description",
		displayName: "Multi-Agent Delegation",
		nameKey: "flowBuilder.features.multiAgentFeature.name",
		tools: [...MULTI_AGENT_FEATURE_TOOLS],
		systemPrompt: MULTI_AGENT_FEATURE_SYSTEM_PROMPT,
		customizable: true,
		icon: { name: "GitFork", type: "lucide" },
		accentColor: "#818cf8",
		section: "core",
		sectionOrder: 4,
		requiresAccessibleAgents: true,
		detailView: [{ component: "AgentPicker" }],
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: MultiAgentFeatureSpec;
	}
}
