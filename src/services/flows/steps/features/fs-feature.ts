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

export interface FsFeatureConfig {}

export type FsFeatureServices = {};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT_INSTRUCTION = `
# FILESYSTEM ACCESS (v2)
You have access to two persistent namespaces through filesystem-style tools.

## NAMESPACES

| Namespace | Root path | Purpose |
|---|---|---|
| Documents | \`/documents\` | User documents, notes, PDFs, and other files |
| Workspaces | \`/workspaces\` | Code projects, scripts, and workspace files |

All paths are absolute. Always prefix paths with the appropriate namespace root:
- Documents: \`/documents/notes/todo.md\`
- Workspaces: \`/workspaces/myproject/src/index.ts\`

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
1. Use \`fs_ls\` on \`/documents\` or \`/workspaces\` to get an overview.
2. Use \`fs_glob\` with a pattern like \`**/*.md\` scoped to a namespace root.
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
  - \`fs_grep pattern="memorall|icon|logo|brand" glob="**/*.{ts,tsx,js,jsx,json,md,svg,html,css}" path="/workspaces"\`
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
- Example: \`fs_glob pattern="**/*.ts" path="/workspaces/myproject"\`

### Efficient file discovery
- When the user asks for a file by concept, name fragment, brand, logo, icon, asset, image, or extension, do not repeat many narrow \`fs_glob\` calls.
- Combine likely filename terms and likely extensions in a single glob per namespace. Example for finding an icon/logo:
  - \`fs_glob pattern="**/*{memorall,icon,logo,brand}*.{png,jpg,jpeg,svg,webp,ico}" path="/documents"\`
  - \`fs_glob pattern="**/*{memorall,icon,logo,brand}*.{png,jpg,jpeg,svg,webp,ico}" path="/workspaces"\`
- If a combined glob returns no matches, broaden once by changing one dimension at a time:
  1. Broaden names: \`**/*{memorall,icon,logo,brand,image,asset}*.{png,jpg,jpeg,svg,webp,ico}\`
  2. Broaden extensions: \`**/*{memorall,icon,logo,brand}*.*\`
  3. List nearby directories with \`fs_ls\` only when glob results suggest a likely folder.
- Do not search only one extension such as \`.svg\` unless the user explicitly asked for that extension.
- Do not retry the same failed pattern in another wording; change the namespace, name alternatives, extension alternatives, or use \`fs_ls\` for structure.

### Organizing files
- \`fs_mkdir\` creates a directory (recursive by default — parent dirs are created automatically).
- \`fs_remove\` deletes a file. To delete a non-empty directory, pass \`recursive: true\`.

## IMPORTANT RULES
- Always use \`fs_read\` before \`fs_edit\` — verify the exact text to replace.
- Prefer \`fs_edit\` over \`fs_write\` when modifying a small portion of a large file.
- Use \`fs_grep\` before reading large files to confirm they contain what you need.
- Both namespaces are persistent — changes are saved immediately.
- When unsure which namespace to use, prefer \`/documents\` for user content and \`/workspaces\` for code.
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
	"Enable filesystem tools with access to both /documents and /workspaces namespaces: glob, grep, read, write, edit, mkdir, remove, ls.";

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
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(input.tools, ...FS_FEATURE_TOOLS);
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
	description: FS_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: true,
});

featureCatalogRegistry.register({
	id: "step-fs-feature",
	name: FS_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with filesystem instructions for both namespaces",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with fs toolset (/documents + /workspaces)",
		},
	],
	metadata: {
		description: FS_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.fsFeature.description",
		displayName: "File System",
		nameKey: "flowBuilder.features.fsFeature.name",
		tools: [...FS_FEATURE_TOOLS],
		systemPrompt: FS_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		recommended: true,
		icon: { name: "HardDrive", type: "lucide" },
		accentColor: "#06b6d4",
		section: "core",
		sectionOrder: 1,
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: FsFeatureSpec;
	}
}
