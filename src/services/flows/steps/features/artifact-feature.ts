import { logError } from "@/utils/logger";
import { defineStep, bindStep } from "@/services/flows/interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows/interfaces/step";
import { stepRegistry } from "@/services/flows/step-registry";
import {
	featureCatalogRegistry,
	FEATURE_DEFAULT_INPUTS,
	type FeatureCatalogMetadata,
} from "@/services/flows/feature-catalog-registry";
import { GraphBase, type GraphTool } from "@/services/flows/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/types/openai";

const STEP_NAME = "artifact-feature" as const;
export const ARTIFACT_FEATURE_NAME = STEP_NAME;
export const ARTIFACT_FEATURE_TOOLS = ["render_memorall_artifact"] as const;

export interface ArtifactFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface ArtifactFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface ArtifactFeatureConfig {}

type ArtifactFeatureServices = Record<string, never>;

const SYSTEM_PROMPT_INSTRUCTION = `
# ARTIFACT RENDERING
You can render visual artifacts inline by calling the \`render_memorall_artifact\` tool.

## Artifact Types
- **text/html**: Renders an HTML preview in a sandboxed iframe. Use for HTML pages, interactive demos, SVG graphics.
- **text/uri-list**: Renders an embedded iframe pointing to a URL. Use for live server previews or external pages.
- **application/hyperframes**: Renders a HyperFrames composition with full playback controls (play/pause, scrub bar, seek). Pass the raw composition HTML as content.

## Usage
Call the tool with:
- \`type\`: \`text/html\`, \`text/uri-list\`, or \`application/hyperframes\`
- \`content\`: the HTML document/source or URL to render
- \`identifier\`: optional stable artifact slug, for example \`wireframe-vnnews-2026-05-01\`
- \`title\`: optional display title

The tool appends a standard \`<artifact identifier="..." type="..." title="...">...</artifact>\` assistant message to graph output state. Its normal tool result is only for model context, so do not print or repeat artifact tags yourself.
`;

export const ARTIFACT_FEATURE_SYSTEM_PROMPT = SYSTEM_PROMPT_INSTRUCTION.trim();
export const ARTIFACT_FEATURE_DESCRIPTION =
	"Enable inline artifact rendering (HTML preview, URL iframe) directly in chat messages.";

const definition = defineStep<
	ArtifactFeatureInput,
	ArtifactFeatureOutput,
	ArtifactFeatureServices,
	ArtifactFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...ARTIFACT_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				ARTIFACT_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[ARTIFACT_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Artifact feature step failed",
					],
				},
			};
		}
	},
});

type ArtifactFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createArtifactFeatureStep: StepFactoryFromSpec<
	ArtifactFeatureSpec
> = (services: ArtifactFeatureServices, config?: ArtifactFeatureConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createArtifactFeatureStep, {
	description: ARTIFACT_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: true,
});

featureCatalogRegistry.register({
	id: "step-artifact-feature",
	name: ARTIFACT_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with artifact rendering instructions.",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with artifact rendering toolset.",
		},
	],
	metadata: {
		description: ARTIFACT_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.artifactFeature.description",
		displayName: "Artifact Renderer",
		nameKey: "flowBuilder.features.artifactFeature.name",
		tools: [...ARTIFACT_FEATURE_TOOLS],
		systemPrompt: ARTIFACT_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "AppWindow", type: "lucide" },
		accentColor: "#6366f1",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ArtifactFeatureSpec;
	}
}
