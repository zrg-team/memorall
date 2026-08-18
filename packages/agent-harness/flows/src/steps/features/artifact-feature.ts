import {
	defineStep,
	bindStep,
} from "../../interfaces/engine/step.js";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/engine/step.js";
import { logError } from "../../logging/logger.js";
import { stepRegistry } from "../../registries/step-registry.js";
import {
	GraphBase,
	hostTool,
	type GraphTool,
} from "../../graph/graph.base.js";
import type { ChatCompletionMessageParam } from "../../interfaces/engine/messages.js";

const STEP_NAME = "artifact-feature" as const;
export const ARTIFACT_FEATURE_NAME = STEP_NAME;
export const ARTIFACT_FEATURE_TOOLS = [hostTool("render_artifact")];

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
You can render visual artifacts inline by calling the \`render_artifact\` tool.

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
	feature: {
		id: "step-artifact-feature",
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
				description: "Messages with artifact rendering instructions.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended with artifact rendering toolset.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: ArtifactFeatureSpec;
	}
}
