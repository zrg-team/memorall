import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { logError } from "flow-core/utils/logger";
import { stepRegistry } from "flow-core/registries/step-registry";
import {
	GraphBase,
	type ConfiguredGraphTool,
	type GraphTool,
} from "flow-core/graph/graph.base";
import type { LottieToolConfig } from "flow-core/tools/lottie/config";
import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";

const STEP_NAME = "lottie-animation-feature" as const;
export const LOTTIE_ANIMATION_FEATURE_NAME = STEP_NAME;

// ============================================================================
// TYPES
// ============================================================================

export interface LottieAnimationFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface LottieAnimationFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface LottieAnimationFeatureConfig extends LottieToolConfig {}

export type LottieAnimationFeatureServices = Record<string, never>;

const SYSTEM_PROMPT_INSTRUCTION = `
# LOTTIE ANIMATION AUTHOR

Your medium is **Lottie (Bodymovin) JSON** — a declarative vector-animation format
rendered by lottie-web, Lottie for iOS/Android/Flutter, and After Effects' Bodymovin plugin.
Everything runs in the browser — no CLI, no Node.js, no AE required.

## Request interpretation

When the user asks for "an animation", "a Lottie", "an icon animation", "a loading
spinner", "a micro-interaction", or similar, treat it as a Lottie composition task.
Execute tool sequences immediately — never describe, explain, or ask first.

## JSON structure rules (violating these renders a blank/broken animation)

1. Top-level: v, fr, ip, op, w, h, layers (assets: [] if unused).
2. Every shape layer (ty: 4) has a "shapes" array whose TOP-LEVEL entries are
   GROUPS ("ty": "gr") — never bare "sh"/"fl"/"st"/"rc" items directly under "shapes".
3. Each group's "it" array = [geometry..., fill/stroke..., transform ("ty": "tr")] —
   the group transform is REQUIRED, even if identity.
4. Animated property: {"a": 1, "k": [{"t": <frame>, "s": [...], "i": {...}, "o": {...}}, ...]}
   Static property: {"a": 0, "k": <value>}  — never mix shapes.
5. Colors are normalized 0-1 RGBA — NOT 0-255.
6. ip/op define visible frame range per layer; composition op = total duration in frames (duration_seconds = op / fr).

## Tool workflow

1. lottie_list — discover existing projects (never guess a project_path)
2. lottie_init — scaffold a new project (writes a minimal valid skeleton)
3. lottie_write — author the full animation.json (new projects or full rewrites)
4. lottie_edit — make targeted edits to an existing animation.json (preferred for small changes, e.g. a color, keyframe value, or single property)
5. lottie_validate — check structure before showing; fix all errors
6. lottie_show — render the animation inline with playback controls

## Project path rules

**Always identify the correct project path before reading or editing.** If the user has not specified a project path in this conversation:

1. Call \`lottie_list\` to see all existing projects and their paths.
2. Pick the project that matches what the user is referring to.
3. If multiple projects exist and it is ambiguous, ask the user which one.

**Never guess** \`project_path\` values. Names like \`default\`, \`project\`, \`untitled\`, \`my-project\`, or any invented slug are forbidden when working on an existing project. Use only paths returned by \`lottie_list\` or paths the user has explicitly stated.

When **creating** a new project with \`lottie_init\`, choose a meaningful slug based on the content (e.g. \`loading-spinner\`, \`success-checkmark\`) — not a generic placeholder.

Never write without reading first on an existing project. Never show without validating first.
Run \`lottie_validate\` before every \`lottie_show\`. If it reports errors, fix them and re-write before showing — never show a broken animation.

Prefer \`lottie_edit\` over \`lottie_write\` when changing a small portion of an existing animation — pass the exact text to replace as \`old_string\`. Use \`lottie_write\` only for new projects (after init) or full rewrites.

## Your role

**CRITICAL — act immediately, never ask:**

- When the user asks to create, update, fix, change, or improve an animation → call the tools RIGHT NOW. Do not describe what you plan to do. Do not ask "would you like me to...". Do not say "here are the changes". Just execute: \`lottie_init\`/\`lottie_read\` → \`lottie_write\` → \`lottie_validate\` → \`lottie_show\`.
- Saying what you are about to do instead of doing it is a failure. Asking for permission to write is a failure. Showing a result summary and waiting is a failure.
- **Never show or paste raw JSON to the user.** The preview IS the deliverable. After \`lottie_show\`, write one short sentence only.

After showing, write one short sentence to the user: what the animation covers and one specific refinement suggestion. Nothing else — no code, no JSON, no step-by-step instructions.
`;

export const LOTTIE_ANIMATION_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

export const LOTTIE_FEATURE_TOOLS = [
	"lottie_list",
	"lottie_init",
	"lottie_write",
	"lottie_edit",
	"lottie_read",
	"lottie_validate",
	"lottie_show",
	"fs_ls",
	"fs_glob",
	"fs_grep",
	"fs_read",
] as const;

export const LOTTIE_ANIMATION_FEATURE_DESCRIPTION =
	"Author, validate, and preview Lottie/Bodymovin vector animations stored as workspace files.";

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	LottieAnimationFeatureInput,
	LottieAnimationFeatureOutput,
	LottieAnimationFeatureServices,
	LottieAnimationFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config }) => {
		try {
			const toolConfig: LottieToolConfig = {
				rootPath: config?.rootPath,
				resourceRoots: config?.resourceRoots,
			};
			const configuredTools = LOTTIE_FEATURE_TOOLS.map(
				(name): ConfiguredGraphTool<LottieToolConfig> => ({
					name,
					config: toolConfig,
				}),
			);
			const tools = GraphBase.chat.addTool(input.tools, ...configuredTools);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				LOTTIE_ANIMATION_FEATURE_SYSTEM_PROMPT,
			);

			return { output: { tools, messages } };
		} catch (error) {
			logError("[LOTTIE_ANIMATION_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Lottie animation feature step failed",
					],
				},
			};
		}
	},
});

type LottieAnimationFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createLottieAnimationFeatureStep: StepFactoryFromSpec<
	LottieAnimationFeatureSpec
> = (
	services: LottieAnimationFeatureServices,
	config?: LottieAnimationFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createLottieAnimationFeatureStep, {
	version: "1.0.0",
	description: LOTTIE_ANIMATION_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	configParams: [
		{
			key: "rootPath",
			type: "string",
			description: "Root path under which Lottie projects are stored.",
		},
		{
			key: "resourceRoots",
			type: "array",
			description:
				"Root path prefixes searched when resolving local asset references.",
		},
	],
	feature: {
		id: "step-lottie-animation-feature",
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
				description: "Messages with Lottie authoring instructions.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Lottie tools: init, write, validate, show.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: LottieAnimationFeatureSpec;
	}
}
