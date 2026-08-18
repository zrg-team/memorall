import {
	defineStep,
	bindStep,
} from "@/services/flows-core/interfaces/engine/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows-core/interfaces/engine/step";
import { logError } from "@/services/flows-core/utils/logger";
import { stepRegistry } from "@/services/flows-core/registries/step-registry";
import {
	GraphBase,
	type ConfiguredGraphTool,
	type GraphTool,
} from "@/services/flows-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/services/flows-core/interfaces/engine/messages";
import {
	HYPERFRAMES_FEATURE_SYSTEM_PROMPT,
	HYPERFRAMES_FEATURE_TOOLS,
	HYPERFRAMES_FEATURE_DESCRIPTION,
} from "@/services/flows-core/steps/features/hyperframes-feature/hyperframes-feature";
import type { HyperframesToolConfig } from "@/services/flows-core/tools/hyperframes/config";
import { memorallFsToolConfig } from "flow-integrations/tools/fs/memorall-fs-path-policy";

const STEP_NAME = "hyperframes-feature" as const;

export interface HyperframesFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface HyperframesFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface HyperframesFeatureConfig extends HyperframesToolConfig {}

export type HyperframesFeatureServices = Record<string, never>;

// ── Memorall-specific path context ────────────────────────────────────────────
// Appended to the generic core system prompt. Instructs the model about the
// single persistent filesystem root exposed by the Memorall host runtime.

const MEMORALL_PATH_CONTEXT = `
# MEMORALL FILESYSTEM PATHS

The Memorall host exposes one persistent virtual filesystem root to HyperFrames tools and previews.

Use normal absolute paths. Read existing user assets such as \`/resources/images/logo.png\`.
Create HyperFrames projects under \`/projects/<slug>\`, e.g. \`/projects/product-launch\`.
All tools target a project path like \`/projects/product-launch\`.
The composition file is always \`{project_path}/index.html\`.

## Path rules

- **Use absolute root paths.** Use paths exactly as returned by tools. \`/images/logo.png\` is wrong unless that file exists; \`/resources/images/logo.png\` is right when that is the returned path.
- **Prefer full workspace paths for project assets.** \`hyperframes_remote_asset_import\` returns an \`html_src\` like \`./resources/images/bg.jpg\` — prefer the full form \`/projects/{project}/resources/images/bg.jpg\`. The relative form works only in static HTML \`<img src>\` via fuzzy filename matching; it is never resolved in JavaScript.
- **Never invent paths.** Prove every asset exists with \`fs_ls\`/\`fs_glob\` or import it with \`hyperframes_remote_asset_import\`.
- **Static HTML only.** Memorall converts \`<img src>\`, SVG \`<image href>\`, \`video poster\`, and CSS \`url(...)\` to base64 — only static HTML attributes, never JavaScript-assigned values.
- **No JS asset loading of any kind.** If JavaScript must reference an asset: declare it once as \`<img id="pre" src="/resources/images/logo.png" hidden>\` in HTML, then read \`document.getElementById('pre').src\` in JS — Memorall has already replaced it with base64 by that point.

**Path quick-reference — wrong vs right:**

| Wrong | Right |
|---|---|
| \`<img src="/images/logo.png">\` | \`<img src="/resources/images/logo.png">\` |
| \`<img src="resources/bg.jpg">\` | \`<img src="/projects/my-project/resources/images/bg.jpg">\` |
| \`<img src="./resources/images/bg.jpg">\` | \`<img src="/projects/my-project/resources/images/bg.jpg">\` |
| \`function fixIconPath(n){ return './resources/icons/'+n; }\` | Forbidden — inline SVG in HTML, or \`<img hidden>\` + read \`.src\` in JS |
| \`img.src = './resources/icons/' + name\` | \`img.src = document.getElementById('pre').src\` |

## Discovering local assets in Memorall

1. **\`fs_ls\`** — list \`/\`, \`/projects\`, or the target \`project_path\` to see what exists.
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
	execute: async ({ input, config }) => {
		try {
			const toolConfig: HyperframesToolConfig = {
				...memorallFsToolConfig,
				rootPath: config?.rootPath,
				resourceRoots: config?.resourceRoots,
			};
			const configuredTools = HYPERFRAMES_FEATURE_TOOLS.map(
				(name): ConfiguredGraphTool<HyperframesToolConfig> => ({
					name,
					config: toolConfig,
				}),
			);
			const tools = GraphBase.chat.addTool(input.tools, ...configuredTools);
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
	configParams: [
		{
			key: "rootPath",
			type: "string",
			default: "/projects",
			description: "Root path under which HyperFrames projects are stored.",
		},
		{
			key: "resourceRoots",
			type: "array",
			default: ["/", "/projects"],
			description:
				"Root path prefixes searched when rewriting local image references to data URLs for iframe rendering.",
		},
	],
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
