import {
	getFlowRuntimeVars,
	getRuntimeString,
} from "@memorall/agent-harness-flows/context/runtime-context";
import {
	GraphBase,
	type GraphTool,
} from "@memorall/agent-harness-flows/graph/graph.base";
import type { ChatCompletionMessageParam } from "@memorall/agent-harness-flows/interfaces/engine/messages";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import {
	bindStep,
	defineStep,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import { logError } from "@memorall/agent-harness-flows/logging/logger";
import { stepRegistry } from "@memorall/agent-harness-flows/registries/step-registry";
import {
	THREAD_HISTORY_READ_TOOL,
	THREAD_HISTORY_SEARCH_TOOL,
	THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
} from "@/services/flows-integrations/tools/thread-history";

const STEP_NAME = "thread-history-feature" as const;
export const THREAD_HISTORY_FEATURE_NAME = STEP_NAME;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface ThreadHistoryFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface ThreadHistoryFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export type ThreadHistoryFeatureConfig = {};

export type ThreadHistoryFeatureServices = {};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const THREAD_HISTORY_FEATURE_SYSTEM_PROMPT = `
# EARLIER THREAD HISTORY
This conversation was split. You can see only the messages after the split point — everything before it is still stored and searchable, but it is not in your context.

Search earlier history when the user's message points outside what you can see:
- a reference to earlier work ("the file we discussed", "that link you sent", "as I mentioned")
- a name, number, path or decision you have no record of above
- a follow-up that assumes context you cannot find in the visible messages
- a direct request to recall, continue or summarise earlier work

Do not search when the visible messages already answer the question, and do not tell the user you have no memory of something before you have looked.

Workflow:
1. \`${THREAD_HISTORY_SEARCH_TOOL}\` with a distinctive keyword or phrase. It returns message IDs with the matching lines and their line numbers.
2. \`${THREAD_HISTORY_READ_TOOL}\` on those IDs for the surrounding range. Read in \`compact\` mode first; switch to \`detail\` only when you need a tool call's arguments or output. Always request a bounded line range — a single stored message can be very large.
`.trim();

export const THREAD_HISTORY_FEATURE_TOOLS: GraphTool[] = [
	THREAD_HISTORY_SEARCH_TOOL,
	THREAD_HISTORY_READ_TOOL,
];

export const THREAD_HISTORY_FEATURE_DESCRIPTION =
	"Let the agent search and read messages from before the chat was split, instead of losing them.";

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	ThreadHistoryFeatureInput,
	ThreadHistoryFeatureOutput,
	ThreadHistoryFeatureServices,
	ThreadHistoryFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, runConfig }) => {
		try {
			// The runtime bag only carries a separator id when the conversation has
			// actually been split. Without one there is no earlier segment to reach,
			// so the feature adds neither prompt nor tools — that is what makes it
			// safe to leave enabled on every agent.
			const separatorId = getRuntimeString(
				getFlowRuntimeVars(runConfig),
				THREAD_HISTORY_SEPARATOR_RUNTIME_KEY,
			);
			if (!separatorId) {
				return { output: { tools: input.tools, messages: input.messages } };
			}

			const tools = GraphBase.chat.addTool(
				input.tools,
				...THREAD_HISTORY_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				THREAD_HISTORY_FEATURE_SYSTEM_PROMPT,
			);

			return { output: { tools, messages } };
		} catch (error) {
			logError("[THREAD_HISTORY_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Thread history feature step failed",
					],
				},
			};
		}
	},
});

type ThreadHistoryFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createThreadHistoryFeatureStep: StepFactoryFromSpec<
	ThreadHistoryFeatureSpec
> = (
	services: ThreadHistoryFeatureServices,
	config?: ThreadHistoryFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createThreadHistoryFeatureStep, {
	description: THREAD_HISTORY_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: true,
	feature: {
		id: "step-thread-history-feature",
		type: "feature",
		// Agents built by the wizard default to the foundation graph, so both
		// graph types are needed for "every agent gets this" to hold.
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
				description: "Messages with guidance on when to look past the split",
			},
			{
				name: "tools",
				type: "Tool[]",
				description:
					"Tools extended with thread_history_search and thread_history_read",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ThreadHistoryFeatureSpec;
	}
}
