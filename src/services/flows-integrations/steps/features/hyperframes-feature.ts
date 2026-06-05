import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { logError } from "flow-core/utils/logger";
import { stepRegistry } from "flow-core/registries/step-registry";
import { GraphBase, type GraphTool } from "flow-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";
import {
	HYPERFRAMES_FEATURE_SYSTEM_PROMPT,
	HYPERFRAMES_FEATURE_TOOLS,
	HYPERFRAMES_FEATURE_DESCRIPTION,
} from "flow-core/steps/features/hyperframes-feature/hyperframes-feature";

const STEP_NAME = "hyperframes-feature" as const;

export interface HyperframesFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface HyperframesFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface HyperframesFeatureConfig {}

export type HyperframesFeatureServices = Record<string, never>;

// ── Memorall-specific path context ────────────────────────────────────────────
// Appended to the generic core system prompt. Instructs the model about the
// two persistent filesystem roots exposed by the Memorall host runtime.

const MEMORALL_PATH_CONTEXT = `
# MEMORALL FILESYSTEM PATHS

The Memorall host exposes two persistent virtual filesystem roots to HyperFrames tools and previews:

| Root | Meaning | Use |
|---|---|---|
| \`/documents\` | User document library. In the UI this appears as "Documents". | Read existing user assets such as \`/documents/images/logo.png\`. Do not write here. |
| \`/workspaces\` | Persistent project/workspace storage. | Create HyperFrames projects here, e.g. \`/workspaces/product-launch\`. |

All tools target a workspace path like \`/workspaces/product-launch\`.
The composition file is always \`{project_path}/index.html\`.

## Path rules

- **Always include the mount prefix.** Use paths exactly as returned by tools: \`/documents/...\` for the user document library, \`/workspaces/...\` for project workspace files. Never drop or shorten the prefix — \`/images/logo.png\` is always wrong; \`/documents/images/logo.png\` is right.
- **Prefer full workspace paths for project assets.** \`hyperframes_remote_asset_import\` returns an \`html_src\` like \`./resources/images/bg.jpg\` — prefer the full form \`/workspaces/{project}/resources/images/bg.jpg\`. The relative form works only in static HTML \`<img src>\` via fuzzy filename matching; it is never resolved in JavaScript.
- **Never invent paths.** Prove every asset exists with \`fs_ls\`/\`fs_glob\` or import it with \`hyperframes_remote_asset_import\`.
- **Static HTML only.** Memorall converts \`<img src>\`, SVG \`<image href>\`, \`video poster\`, and CSS \`url(...)\` to base64 — only static HTML attributes, never JavaScript-assigned values.
- **No JS asset loading of any kind.** If JavaScript must reference an asset: declare it once as \`<img id="pre" src="/documents/..." hidden>\` in HTML, then read \`document.getElementById('pre').src\` in JS — Memorall has already replaced it with base64 by that point.

**Path quick-reference — wrong vs right:**

| Wrong | Right |
|---|---|
| \`<img src="/images/logo.png">\` | \`<img src="/documents/images/logo.png">\` |
| \`<img src="resources/bg.jpg">\` | \`<img src="/workspaces/my-project/resources/images/bg.jpg">\` |
| \`<img src="./resources/images/bg.jpg">\` | \`<img src="/workspaces/my-project/resources/images/bg.jpg">\` |
| \`function fixIconPath(n){ return './resources/icons/'+n; }\` | Forbidden — inline SVG in HTML, or \`<img hidden>\` + read \`.src\` in JS |
| \`img.src = './resources/icons/' + name\` | \`img.src = document.getElementById('pre').src\` |

## Discovering local assets in Memorall

1. **\`fs_ls\`** — list \`/documents\`, \`/workspaces\`, or the target \`project_path\` to see what exists.
2. **\`fs_glob\`** — hunt for images, logos, or brand files by pattern (e.g. \`**/*.{png,jpg,svg}\`, \`**/*logo*\`).
3. **\`fs_grep\`** — find brand hex codes, color tokens, product names, or asset references inside files.
4. **\`fs_read\`** — open a specific text file only after \`fs_glob\`/\`fs_grep\` have identified it. Never use it on binary images.
`;

const MEMORALL_HYPERFRAMES_SYSTEM_PROMPT =
	HYPERFRAMES_FEATURE_SYSTEM_PROMPT + "\n\n" + MEMORALL_PATH_CONTEXT.trim();

// ── Step ──────────────────────────────────────────────────────────────────────

const definition = defineStep<
	HyperframesFeatureInput,
	HyperframesFeatureOutput,
	HyperframesFeatureServices,
	HyperframesFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...HYPERFRAMES_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				MEMORALL_HYPERFRAMES_SYSTEM_PROMPT,
			);

			return { output: { tools, messages } };
		} catch (error) {
			logError("[HYPERFRAMES_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "HyperFrames feature step failed",
					],
				},
			};
		}
	},
});

type HyperframesFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createHyperframesFeatureStep: StepFactoryFromSpec<
	HyperframesFeatureSpec
> = (services: HyperframesFeatureServices, config?: HyperframesFeatureConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createHyperframesFeatureStep, {
	version: "2.0.0",
	description: HYPERFRAMES_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: {
		id: "step-hyperframes-feature",
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
				description:
					"Messages with HyperFrames composition instructions and Memorall path context.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "HyperFrames tools: write, validate, show, capture.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: HyperframesFeatureSpec;
	}
}
