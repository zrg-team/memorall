import {
	defineStep,
	bindStep,
} from "@/services/flows-core/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows-core/interfaces/engine/step";
import { logError } from "@/services/flows-core/utils/logger";
import { stepRegistry } from "@/services/flows-core/registries/step-registry";
import {
	GraphBase,
	type GraphTool,
} from "@/services/flows-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/services/flows-core/interfaces/engine/messages";
import { CO_AGENT_TOOLS } from "../../tools/co-agent";

export const EMBEDDED_CHAT_FEATURE_STEP_NAME = "embedded-chat-feature" as const;

export const EMBEDDED_CHAT_SYSTEM_PROMPT = `
# EMBEDDED CHAT PAGE TOOLS
You are answering inside the embedded chat panel on the user's current browser page.

Use the user's attached page context and system page metadata first. When more live page evidence is needed, use the current-tab tools:
- Use co_agent_observe with scope="metadata" for cheap URL/title/viewport orientation.
- Use co_agent_observe with scope="viewport" when the user asks about what is currently visible.
- Use co_agent_observe with scope="page" for whole-page summaries, product facts, comparisons, or finding content across the page.
- Use co_agent_observe with scope="selection" when the user's prompt includes selected text context.
- Use co_agent_query, co_agent_move, and co_agent_scroll when the user asks where something is, says "show me", "point to", or asks to locate an element.

When the user wants you to control, navigate, inspect, or do something on the current website, use the co_agent_* tools for the active page instead of generic web_* tools such as web_open, web_read, web_wait, or web_search. EmbeddedChat is already attached to the user's current browser page; do not open a separate web session for current-page actions.

Answer from evidence. Do not use click or input tools unless the user clearly asks you to interact with the page. Never submit purchases, payments, login/security changes, credential entry, uploads, or browser permission actions.
`.trim();

interface EmbeddedChatFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

interface EmbeddedChatFeatureOutput {
	messages?: ChatCompletionMessageParam[];
	tools?: GraphTool[];
}

type EmbeddedChatFeatureServices = Record<string, never>;
interface EmbeddedChatFeatureConfig {}

const definition = defineStep<
	EmbeddedChatFeatureInput,
	EmbeddedChatFeatureOutput,
	EmbeddedChatFeatureServices,
	EmbeddedChatFeatureConfig
>({
	name: EMBEDDED_CHAT_FEATURE_STEP_NAME,
	execute: async ({ input }) => {
		try {
			return {
				output: {
					tools: GraphBase.chat.addTool(input.tools, ...CO_AGENT_TOOLS),
					messages: GraphBase.chat.systemMessage(
						input.messages,
						EMBEDDED_CHAT_SYSTEM_PROMPT,
					),
				},
			};
		} catch (error) {
			logError("[EMBEDDED_CHAT_FEATURE] Failed:", error);
			return {
				output: {
					tools: input.tools,
					messages: input.messages,
				},
			};
		}
	},
});

type EmbeddedChatFeatureSpec = StepSpecFromDefinition<typeof definition>;

const createEmbeddedChatFeatureStep: StepFactoryFromSpec<
	EmbeddedChatFeatureSpec
> = (
	services: EmbeddedChatFeatureServices,
	config?: EmbeddedChatFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(
	EMBEDDED_CHAT_FEATURE_STEP_NAME,
	createEmbeddedChatFeatureStep,
	{
		description:
			"Enable EmbeddedChat current-page browser tools and concise page-chat instructions.",
		defaultStateMapping: { messages: "messages", tools: "tools" },
		enabledByDefault: false,
		feature: {
			id: "step-embedded-chat-feature",
			type: "feature",
			graphTypes: ["foundation", "agent"],
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
			],
			outputs: [
				{
					name: "messages",
					type: "Message[]",
					description: "Messages with EmbeddedChat browser instructions.",
				},
				{
					name: "tools",
					type: "Tool[]",
					description: "Tools extended with current-page browser controls.",
				},
			],
		},
	},
);

declare global {
	interface StepTypeRegistry {
		[EMBEDDED_CHAT_FEATURE_STEP_NAME]: EmbeddedChatFeatureSpec;
	}
}
