import {
	defineStep,
	bindStep,
} from "@/services/flows-legacy/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows-legacy/interfaces/engine/step";
import { logError } from "@/services/flows-legacy/utils/logger";
import { stepRegistry } from "@/services/flows-legacy/registries/step-registry";
import {
	GraphBase,
	type GraphTool,
} from "@/services/flows-legacy/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/services/flows-legacy/interfaces/engine/messages";

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
You can generate PDF files and save them to the root filesystem using the \`pdf_generate\` tool.

## TOOL OVERVIEW

| Tool | Purpose |
|---|---|
| \`pdf_generate\` | Generate a PDF from a URL, Markdown text, or HTML and save it to the root filesystem |

## USAGE

- \`source_type\`: \`"url"\` | \`"markdown"\` | \`"html"\`
- \`content\`: the URL, Markdown string, or HTML string to render
- \`output_path\`: where to save the PDF in the root filesystem (must end with \`.pdf\`)
- \`options\`: optional \`page_size\` (a4/letter/legal), \`orientation\` (portrait/landscape), \`margin_mm\`
- Parent folders are created automatically.

## IMPORTANT RULES
- After saving a PDF, only mention the file path — do not include the content in your response.
`;

export const PDF_GENERATE_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

export const PDF_GENERATE_FEATURE_TOOLS = ["pdf_generate"] as const;

export const PDF_GENERATE_FEATURE_DESCRIPTION =
	"Enable PDF generation tool: create a PDF from a URL, Markdown text, or HTML and save it to the root filesystem.";

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
	feature: {
		id: "step-pdf-generate-feature",
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
				description: "Messages with PDF generation instructions",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with pdf_generate",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: PdfGenerateFeatureSpec;
	}
}
