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
import type { FsToolConfig } from "@/services/flows-core/tools/fs/config";

const STEP_NAME = "fs-feature" as const;
export const FS_FEATURE_NAME = STEP_NAME;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface FsFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface FsFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface FsFeatureConfig extends FsToolConfig {}

export type FsFeatureServices = {};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT_INSTRUCTION = `
# FILESYSTEM ACCESS

## DISCOVERY STRATEGY
- Start broad: glob or ls to understand structure, then narrow with grep before reading.
- Combine alternatives in a single call rather than repeating with small variations.
- Use grep's \`output_mode: "files_with_matches"\` to get candidate paths first, then read only what you need.
- Use grep's \`context\` lines and glob/type filters to reduce noise in a single pass.

## READ / EDIT STRATEGY
- Always read a file before editing — you need the exact text to match.
- Prefer targeted edits over full rewrites; use \`replace_all\` only when renaming across the file.
- For large files, read in chunks with \`offset\` / \`limit\` rather than loading everything.
- After writing or editing, only mention the file path — do not echo its content.

## WRITE / DELETE STRATEGY
- Writes fully overwrite — use only for new files or intentional full replacements.
- Deletes are irreversible; confirm the path is correct before removing.
`;

export const FS_FEATURE_SYSTEM_PROMPT = SYSTEM_PROMPT_INSTRUCTION.trim();

export const FS_FEATURE_TOOLS = [
	"fs_ls",
	"fs_glob",
	"fs_grep",
	"fs_read",
	"fs_write",
	"fs_edit",
	"fs_mkdir",
	"fs_remove",
] as const;

export const FS_FEATURE_DESCRIPTION =
	"Enable filesystem tools: glob, grep, read, write, edit, mkdir, remove, ls.";

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	FsFeatureInput,
	FsFeatureOutput,
	FsFeatureServices,
	FsFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config }) => {
		try {
			const configuredTools = FS_FEATURE_TOOLS.map(
				(name): ConfiguredGraphTool<FsToolConfig> => ({
					name,
					config,
				}),
			);
			const tools = GraphBase.chat.addTool(input.tools, ...configuredTools);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				FS_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[FS_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Filesystem feature step failed",
					],
				},
			};
		}
	},
});

type FsFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createFsFeatureStep: StepFactoryFromSpec<FsFeatureSpec> = (
	services: FsFeatureServices,
	config?: FsFeatureConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createFsFeatureStep, {
	version: "1.0.0",
	description: FS_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: FsFeatureSpec;
	}
}
