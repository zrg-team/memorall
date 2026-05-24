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

### Finding files by name/pattern
- \`document_fs_glob\` accepts glob syntax:
  - \`*\` matches anything in a single directory segment.
  - \`**\` matches across any number of directory levels.
  - \`?\` matches any single character.
- Example patterns: \`"**/*.pdf"\`, \`"reports/**"\`, \`"notes/2024-*.md"\`.

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
