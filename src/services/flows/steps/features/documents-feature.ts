import { logError } from "../../interfaces/logger";
import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../interfaces/messages";

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
});

featureCatalogRegistry.register({
	id: "step-documents-feature",
	name: DOCUMENTS_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
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
	metadata: {
		description: `[LEGACY] ${DOCUMENTS_FEATURE_DESCRIPTION} Use "documents-fs-feature" instead.`,
		descriptionKey: "flowBuilder.features.documentsFeature.description",
		displayName: "Documents (Legacy)",
		nameKey: "flowBuilder.features.documentsFeature.name",
		tools: [...DOCUMENTS_FEATURE_TOOLS],
		systemPrompt: DOCUMENTS_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		legacy: true,
		recommended: false,
		icon: { name: "FileText", type: "lucide" },
		accentColor: "#94a3b8",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: DocumentsFeatureSpec;
	}
}
