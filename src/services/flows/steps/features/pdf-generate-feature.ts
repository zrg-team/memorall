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

const STEP_NAME = "pdf-generate-feature" as const;
export const PDF_GENERATE_FEATURE_NAME = STEP_NAME;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface PdfGenerateFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface PdfGenerateFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface PdfGenerateFeatureConfig {}

export type PdfGenerateFeatureServices = {};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT_INSTRUCTION = `
# PDF GENERATION
You can generate PDF files and save them to /documents using the \`pdf_generate\` tool.

## TOOL OVERVIEW

| Tool | Purpose |
|---|---|
| \`pdf_generate\` | Generate a PDF from a URL, Markdown text, or HTML and save it to /documents |

## USAGE

- \`source_type\`: \`"url"\` | \`"markdown"\` | \`"html"\`
- \`content\`: the URL, Markdown string, or HTML string to render
- \`output_path\`: where to save the PDF in /documents (must end with \`.pdf\`)
- \`options\`: optional \`page_size\` (a4/letter/legal), \`orientation\` (portrait/landscape), \`margin_mm\`
- Parent folders are created automatically.

## IMPORTANT RULES
- After saving a PDF, only mention the file path — do not include the content in your response.
`;

export const PDF_GENERATE_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

export const PDF_GENERATE_FEATURE_TOOLS = ["pdf_generate"] as const;

export const PDF_GENERATE_FEATURE_DESCRIPTION =
	"Enable PDF generation tool: create a PDF from a URL, Markdown text, or HTML and save it to /documents.";

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	PdfGenerateFeatureInput,
	PdfGenerateFeatureOutput,
	PdfGenerateFeatureServices,
	PdfGenerateFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...PDF_GENERATE_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				PDF_GENERATE_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[PDF_GENERATE_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "PDF generate feature step failed",
					],
				},
			};
		}
	},
});

type PdfGenerateFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createPdfGenerateFeatureStep: StepFactoryFromSpec<
	PdfGenerateFeatureSpec
> = (services: PdfGenerateFeatureServices, config?: PdfGenerateFeatureConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createPdfGenerateFeatureStep, {
	description: PDF_GENERATE_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-pdf-generate-feature",
	name: PDF_GENERATE_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with PDF generation instructions",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with pdf_generate",
		},
	],
	metadata: {
		description: PDF_GENERATE_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.pdfGenerateFeature.description",
		displayName: "PDF Generate",
		nameKey: "flowBuilder.features.pdfGenerateFeature.name",
		tools: [...PDF_GENERATE_FEATURE_TOOLS],
		systemPrompt: PDF_GENERATE_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		recommended: false,
		icon: { name: "FilePlus", type: "lucide" },
		accentColor: "#ef4444",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: PdfGenerateFeatureSpec;
	}
}
