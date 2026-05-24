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

const STEP_NAME = "documents-fs-feature" as const;
export const DOCUMENTS_FS_FEATURE_NAME = STEP_NAME;

// ============================================================================
// STEP-SPECIFIC TYPES
// ============================================================================

export interface DocumentsFsFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface DocumentsFsFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export interface DocumentsFsFeatureConfig {}

export type DocumentsFsFeatureServices = {};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT_INSTRUCTION = `
# DOCUMENT FILESYSTEM ACCESS (v2)
You have access to the user's document workspace through a set of filesystem-style tools.
The workspace root is "/" — all paths are absolute virtual paths (e.g. "/notes/todo.md").

## TOOLS OVERVIEW

| Tool | Purpose |
|---|---|
| \`document_fs_ls\` | List files and directories at a path |
| \`document_fs_glob\` | Find files matching a glob pattern |
| \`document_fs_grep\` | Search file content by regex pattern |
| \`document_fs_read\` | Read a file with line numbers |
| \`document_fs_write\` | Create or overwrite a file |
| \`document_fs_edit\` | Replace exact text inside a file |
| \`document_fs_mkdir\` | Create a directory |
| \`document_fs_remove\` | Delete a file or directory |

## RECOMMENDED WORKFLOWS

### Exploring the workspace
1. Start with \`document_fs_ls\` (path: "/") to get an overview of the top-level structure.
2. Use \`document_fs_glob\` with a pattern like \`**/*.md\` to find all files of a type.
3. Use \`document_fs_grep\` to locate files containing specific content before reading them.

### Reading files
- Use \`document_fs_read\` to read a file. It returns content with line numbers (cat -n style).
- For large files, use \`offset\` and \`limit\` to read in chunks (e.g. offset: 1, limit: 100).
- Always read a file before editing it — you need to see the current content.

### Creating or updating files
- \`document_fs_write\` creates a new file or **fully overwrites** an existing one. Use this for new files or complete rewrites.
- \`document_fs_edit\` replaces an exact string within an existing file. Use this for targeted edits to avoid rewriting the whole file.
  - \`old_string\` must match exactly (including whitespace and newlines).
  - Set \`replace_all: true\` to replace every occurrence; default replaces only the first.
- After writing or editing a file, do not include the file content in assistant message content. Only mention the path of the file that was created or updated.

### Searching content
- \`document_fs_grep\` accepts a regex \`pattern\` and returns results in \`file:line:content\` format.
- Use \`glob\` to restrict the search to specific file types (e.g. \`"*.ts"\`, \`"**/*.md"\`).
- Use \`context\` (number of surrounding lines) to get more context around each match.
- Use \`output_mode: "files_with_matches"\` to get only file paths, or \`"count"\` for match counts per file.
- For ambiguous content searches, combine likely terms in one regex and likely file types in one glob:
  - \`document_fs_grep pattern="memorall|icon|logo|brand" glob="**/*.{md,json,svg,html,css,txt}" path="/"\`
- Prefer \`output_mode: "files_with_matches"\` first when you only need candidate paths, then read the best matching files.
- Do not repeat several \`document_fs_grep\` calls that only vary one word or one extension; use regex alternatives and glob alternatives.

### Finding files by name/pattern
- \`document_fs_glob\` accepts glob syntax:
  - \`*\` matches anything in a single directory segment.
  - \`**\` matches across any number of directory levels.
  - \`?\` matches any single character.
  - \`{a,b}\` matches alternatives; use it to combine likely names or extensions in one call.
  - \`[abc]\` and \`[!abc]\` match character sets.
  - \`@(a|b)\` matches one of the alternatives.
- Example patterns: \`"**/*.pdf"\`, \`"reports/**"\`, \`"notes/2024-*.md"\`.

### Efficient file discovery
- When the user asks for a file by concept, name fragment, brand, logo, icon, asset, image, or extension, do not repeat many narrow \`document_fs_glob\` calls.
- Combine likely filename terms and likely extensions in a single glob. Example for finding an icon/logo:
  - \`document_fs_glob pattern="**/*{memorall,icon,logo,brand}*.{png,jpg,jpeg,svg,webp,ico}" path="/"\`
- If a combined glob returns no matches, broaden once by changing one dimension at a time:
  1. Broaden names: \`**/*{memorall,icon,logo,brand,image,asset}*.{png,jpg,jpeg,svg,webp,ico}\`
  2. Broaden extensions: \`**/*{memorall,icon,logo,brand}*.*\`
  3. List nearby directories with \`document_fs_ls\` only when glob results suggest a likely folder.
- Do not search only one extension such as \`.svg\` unless the user explicitly asked for that extension.
- Do not retry the same failed pattern in another wording; change the name alternatives, extension alternatives, or use \`document_fs_ls\` for structure.

### Organizing files
- \`document_fs_mkdir\` creates a directory (recursive by default — parent dirs are created automatically).
- \`document_fs_remove\` deletes a file. To delete a non-empty directory, pass \`recursive: true\`.

## IMPORTANT RULES
- Always use \`document_fs_read\` before \`document_fs_edit\` — verify the exact text to replace.
- Prefer \`document_fs_edit\` over \`document_fs_write\` when modifying a small portion of a large file.
- Use \`document_fs_grep\` before reading large files to confirm they contain what you need.
- Paths that do not start with "/" are treated as relative to "/" automatically.
- The workspace is shared and persistent — changes are saved immediately.
`;

export const DOCUMENTS_FS_FEATURE_SYSTEM_PROMPT =
	SYSTEM_PROMPT_INSTRUCTION.trim();

export const DOCUMENTS_FS_FEATURE_TOOLS = [
	"document_fs_ls",
	"document_fs_glob",
	"document_fs_grep",
	"document_fs_read",
	"document_fs_write",
	"document_fs_edit",
	"document_fs_mkdir",
	"document_fs_remove",
] as const;

export const DOCUMENTS_FS_FEATURE_DESCRIPTION =
	"Enable filesystem-style document tools (v2): glob, grep, read, write, edit, mkdir, remove, ls — modeled after Claude Code's file tools.";

// ============================================================================
// STEP IMPLEMENTATION
// ============================================================================

const definition = defineStep<
	DocumentsFsFeatureInput,
	DocumentsFsFeatureOutput,
	DocumentsFsFeatureServices,
	DocumentsFsFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...DOCUMENTS_FS_FEATURE_TOOLS,
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				DOCUMENTS_FS_FEATURE_SYSTEM_PROMPT,
			);

			return {
				output: {
					tools,
					messages,
				},
			};
		} catch (error) {
			logError("[DOCUMENTS_FS_FEATURE] Failed:", error);

			return {
				output: {
					tools: input.tools,
					messages: input.messages,
					errors: [
						error instanceof Error
							? error.message
							: "Documents filesystem feature step failed",
					],
				},
			};
		}
	},
});

type DocumentsFsFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createDocumentsFsFeatureStep: StepFactoryFromSpec<
	DocumentsFsFeatureSpec
> = (services: DocumentsFsFeatureServices, config?: DocumentsFsFeatureConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createDocumentsFsFeatureStep, {
	description: DOCUMENTS_FS_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

featureCatalogRegistry.register({
	id: "step-documents-fs-feature",
	name: DOCUMENTS_FS_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: [
		{
			name: "messages",
			type: "Message[]",
			description: "Messages with document filesystem instructions",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with fs toolset (v2)",
		},
	],
	metadata: {
		description: DOCUMENTS_FS_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.documentsFsFeature.description",
		displayName: "Documents File System",
		nameKey: "flowBuilder.features.documentsFsFeature.name",
		tools: [...DOCUMENTS_FS_FEATURE_TOOLS],
		systemPrompt: DOCUMENTS_FS_FEATURE_SYSTEM_PROMPT,
		customizable: false,
		recommended: false,
		legacy: true,
		icon: { name: "FolderOpen", type: "lucide" },
		accentColor: "#3b82f6",
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: DocumentsFsFeatureSpec;
	}
}
