import {
	defineStep,
	bindStep,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import { logError } from "@memorall/agent-harness-flows/logging/logger";
import { stepRegistry } from "@memorall/agent-harness-flows/registries/step-registry";
import {
	GraphBase,
	type GraphTool,
} from "@memorall/agent-harness-flows/graph/graph.base";
import type { ChatCompletionMessageParam } from "@memorall/agent-harness-flows/interfaces/engine/messages";

const STEP_NAME = "documents-feature" as const;
export const DOCUMENTS_FEATURE_NAME = STEP_NAME;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface DocumentsFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface DocumentsFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface DocumentsFeatureConfig {}

export type DocumentsFeatureServices = {};

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const SYSTEMP_PROMPT_INSTRUCTION = `
# DOCUMENT's FILES ACCESS
You can access to a document space to handle users documents
Always use: "doc_search", "doc_read", "doc_write", "doc_edit", "doc_remove", "doc_move" tools when user mention about "documents"
After writing or editing a document, do not include the file content in assistant message content. Only mention the path of the file that was created or updated.
`;
export const DOCUMENTS_FEATURE_SYSTEM_PROMPT =
	SYSTEMP_PROMPT_INSTRUCTION.trim();
export const DOCUMENTS_FEATURE_TOOLS = [
	"doc_search",
	"doc_read",
	"doc_write",
	"doc_edit",
	"doc_remove",
	"doc_move",
] as const;
export const DOCUMENTS_FEATURE_DESCRIPTION =
	"Enable document workspace tools for searching, reading, writing, editing, moving, and removing documents.";

const definition = defineStep<
	DocumentsFeatureInput,
	DocumentsFeatureOutput,
	DocumentsFeatureServices,
	DocumentsFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...DOCUMENTS_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				DOCUMENTS_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[CONTEXT_RETRIEVE_KNOWLEDGE] Failed:", error);

			return {
				output: {
					tools: input.tools,
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

type DocumentsFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createStep: StepFactoryFromSpec<DocumentsFeatureSpec> = (
	services: DocumentsFeatureServices,
	config?: DocumentsFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createStep, {
	description: `[Legacy] ${DOCUMENTS_FEATURE_DESCRIPTION} Prefer documents-fs-feature.`,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: {
		id: "step-documents-feature",
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
		],
		outputs: [
			{
				name: "messages",
				type: "Message[]",
				description: "Messages with documents feature instruction",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with documents toolset",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: DocumentsFeatureSpec;
	}
}
