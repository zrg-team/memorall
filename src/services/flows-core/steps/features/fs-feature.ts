import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
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
import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";
import type { FsToolConfig } from "flow-core/tools/fs/config";

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
# FILESYSTEM ACCESS (v2)
You have access to filesystem-style tools. Paths are absolute virtual paths
provided by the host runtime.

## TOOLS OVERVIEW

| Tool | Purpose |
|---|---|
| \`fs_ls\` | List files and directories at a path |
| \`fs_glob\` | Find files matching a glob pattern |
| \`fs_grep\` | Search file content by regex pattern |
| \`fs_read\` | Read a file with line numbers |
| \`fs_write\` | Create or overwrite a file |
| \`fs_edit\` | Replace exact text inside a file |
| \`fs_mkdir\` | Create a directory |
| \`fs_remove\` | Delete a file or directory |

## RECOMMENDED WORKFLOWS

### Exploring the filesystem
1. Use \`fs_ls\` to inspect a known root or directory.
2. Use \`fs_glob\` with a pattern like \`**/*.md\` scoped to a known root.
3. Use \`fs_grep\` to locate files containing specific content before reading.

### Reading files
- Use \`fs_read\` to read a file. It returns content with line numbers (cat -n style).
- For large files, use \`offset\` and \`limit\` to read in chunks (e.g. offset: 1, limit: 100).
- Always read a file before editing it — you need to see the current content.

### Creating or updating files
- \`fs_write\` creates a new file or **fully overwrites** an existing one.
- \`fs_edit\` replaces an exact string within an existing file. Use for targeted edits.
  - \`old_string\` must match exactly (including whitespace and newlines).
  - Set \`replace_all: true\` to replace every occurrence; default replaces only the first.
- After writing or editing a file, do not include the file content in assistant message content. Only mention the path of the file that was created or updated.

### Searching content
- \`fs_grep\` accepts a regex \`pattern\` and returns results in \`file:line:content\` format.
- Use \`glob\` to restrict the search to specific file types (e.g. \`"*.ts"\`, \`"**/*.md"\`).
- Use \`context\` (number of surrounding lines) to get more context around each match.
- Use \`output_mode: "files_with_matches"\` to get only file paths, or \`"count"\` for match counts.
- For ambiguous content searches, combine likely terms in one regex and likely file types in one glob:
  - \`fs_grep pattern="icon|logo|brand" glob="**/*.{ts,tsx,js,jsx,json,md,svg,html,css}" path="/"\`
- Prefer \`output_mode: "files_with_matches"\` first when you only need candidate paths, then read the best matching files.
- Do not repeat several \`fs_grep\` calls that only vary one word or one extension; use regex alternatives and glob alternatives.

### Finding files by name/pattern
- \`fs_glob\` accepts glob syntax:
  - \`*\` matches anything in a single directory segment.
  - \`**\` matches across any number of directory levels.
  - \`?\` matches any single character.
  - \`{a,b}\` matches alternatives; use it to combine likely names or extensions in one call.
  - \`[abc]\` and \`[!abc]\` match character sets.
  - \`@(a|b)\` matches one of the alternatives.
- Example: \`fs_glob pattern="**/*.ts" path="/"\`

### Efficient file discovery
- When the user asks for a file by concept, name fragment, brand, logo, icon, asset, image, or extension, do not repeat many narrow \`fs_glob\` calls.
- Combine likely filename terms and likely extensions in a single glob. Example for finding an icon/logo:
  - \`fs_glob pattern="**/*{icon,logo,brand}*.{png,jpg,jpeg,svg,webp,ico}" path="/"\`
- If a combined glob returns no matches, broaden once by changing one dimension at a time:
  1. Broaden names: \`**/*{icon,logo,brand,image,asset}*.{png,jpg,jpeg,svg,webp,ico}\`
  2. Broaden extensions: \`**/*{icon,logo,brand}*.*\`
  3. List nearby directories with \`fs_ls\` only when glob results suggest a likely folder.
- Do not search only one extension such as \`.svg\` unless the user explicitly asked for that extension.
- Do not retry the same failed pattern in another wording; change the root, name alternatives, extension alternatives, or use \`fs_ls\` for structure.

### Organizing files
- \`fs_mkdir\` creates a directory (recursive by default — parent dirs are created automatically).
- \`fs_remove\` deletes a file. To delete a non-empty directory, pass \`recursive: true\`.

## IMPORTANT RULES
- Always use \`fs_read\` before \`fs_edit\` — verify the exact text to replace.
- Prefer \`fs_edit\` over \`fs_write\` when modifying a small portion of a large file.
- Use \`fs_grep\` before reading large files to confirm they contain what you need.
- The host runtime defines persistence and write permissions for available paths.
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
