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

const STEP_NAME = "document-convert-feature" as const;
export const DOCUMENT_CONVERT_FEATURE_NAME = STEP_NAME;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface DocumentConvertFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface DocumentConvertFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface DocumentConvertFeatureConfig {}

export type DocumentConvertFeatureServices = {};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT_INSTRUCTION = `
# DOCUMENT CONVERSION TOOLS
You have access to tools for extracting text from PDF and Excel files, and rendering PDF pages as images, stored in /documents.

## TOOLS OVERVIEW

| Tool | Purpose |
|---|---|
| \`pdf_metadata\` | Read PDF page count, document metadata, and image-page detection |
| \`pdf_to_text\` | Extract text from a PDF in /documents |
| \`pdf_to_image\` | Render PDF pages as PNG base64 images and pass them back to the model as image inputs |
| \`excel_to_text\` | Extract text or tables from an Excel file in /documents |

## pdf_metadata

Reads metadata from a PDF at \`source_path\` (must end with \`.pdf\`).
- Returns a clean text summary with total page count, document metadata, per-page dimensions, whether the PDF contains images, and which pages contain image operators.
- Always call \`pdf_metadata\` first before \`pdf_to_text\` or \`pdf_to_image\` when working with a PDF.

## pdf_to_text

Extracts text from a PDF at \`source_path\` (must end with \`.pdf\`).
- \`output_path\`: optional — save extracted text to this path in /documents. If omitted, text is returned directly.
- \`format\`: \`"text"\` (default, with page separators) | \`"markdown"\` (with frontmatter and page headings)
- \`page_range\`: optional \`{ start, end }\` (1-based) to extract a specific page range only.
- Parent folders are created automatically when \`output_path\` is set.

## pdf_to_image

Renders PDF pages at \`source_path\` (must end with \`.pdf\`) as PNG images.
- \`mode\`: optional \`"page"\` (default, render full pages) | \`"images"\` (extract embedded/inline raster images from selected pages when available).
- \`page_range\`: optional \`{ start, end }\` (1-based). Defaults to the first page.
- \`scale\`: optional number from \`0.25\` to \`3\`. Defaults to \`1.5\`.
- \`detail\`: optional \`"auto"\` (default) | \`"low"\` | \`"high"\` image detail hint.
- \`prompt\`: optional text to send alongside the rendered images.
- The tool returns OpenAI-compatible content parts directly:
  \`[{ "type": "text", "text": "..." }, { "type": "image_url", "image_url": { "url": "data:image/png;base64,...", "detail": "auto" } }]\`.
- Use \`mode: "images"\` when the user asks for images contained in a PDF page.
- Use \`mode: "page"\` when the user asks for page visual/layout inspection.
- Only use this after \`pdf_metadata\` shows \`Has images: yes\`, or when the user explicitly requests visual/layout inspection. Prefer using only the pages listed in \`Image pages\`.

## excel_to_text

Extracts text from an Excel file at \`source_path\` (must end with \`.xls\`, \`.xlsx\`, or \`.xlsm\`).
- \`output_path\`: optional — save extracted text to this path in /documents. If omitted, text is returned directly.
- \`format\`: \`"markdown"\` (default, each sheet as a Markdown table) | \`"csv"\` (each sheet as CSV rows)
- \`sheets\`: optional array of sheet names to include. Defaults to all sheets.
- Parent folders are created automatically when \`output_path\` is set.

## IMPORTANT RULES
- For PDFs, call \`pdf_metadata\` first.
- Use \`pdf_to_image\` only when metadata shows image-containing pages or when the user explicitly asks for visual/layout analysis.
- After saving extracted text, only mention the output path — do not include the full text in your response.
- Prefer saving to a file for long documents to keep responses concise.
`;

export const DOCUMENT_CONVERT_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

export const DOCUMENT_CONVERT_FEATURE_TOOLS = [
	"pdf_metadata",
	"pdf_to_text",
	"pdf_to_image",
	"excel_to_text",
] as const;

export const DOCUMENT_CONVERT_FEATURE_DESCRIPTION =
	"Enable document conversion tools: inspect PDF metadata, extract text from PDFs, render PDFs as images, and extract text or tables from Excel files.";

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	DocumentConvertFeatureInput,
	DocumentConvertFeatureOutput,
	DocumentConvertFeatureServices,
	DocumentConvertFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...DOCUMENT_CONVERT_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				DOCUMENT_CONVERT_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[DOCUMENT_CONVERT_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Document convert feature step failed",
					],
				},
			};
		}
	},
});

type DocumentConvertFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createDocumentConvertFeatureStep: StepFactoryFromSpec<
	DocumentConvertFeatureSpec
> = (
	services: DocumentConvertFeatureServices,
	config?: DocumentConvertFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createDocumentConvertFeatureStep, {
	description: DOCUMENT_CONVERT_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-document-convert-feature",
	name: DOCUMENT_CONVERT_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with document conversion instructions",
		},
		{
			name: "tools",
			type: "Tool[]",
			description:
				"Tools extended with pdf_metadata, pdf_to_text, pdf_to_image, and excel_to_text",
		},
	],
	metadata: {
		description: DOCUMENT_CONVERT_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.documentConvertFeature.description",
		displayName: "Document Convert",
		nameKey: "flowBuilder.features.documentConvertFeature.name",
		tools: [...DOCUMENT_CONVERT_FEATURE_TOOLS],
		systemPrompt: DOCUMENT_CONVERT_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		recommended: false,
		icon: { name: "FileOutput", type: "lucide" },
		accentColor: "#f59e0b",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: DocumentConvertFeatureSpec;
	}
}
