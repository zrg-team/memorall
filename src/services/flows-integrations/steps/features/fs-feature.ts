import { defineStep, bindStep } from "flow-core/interfaces/engine/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "flow-core/interfaces/engine/step";
import { GraphBase, type GraphTool } from "flow-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "flow-core/interfaces/engine/messages";
import { stepRegistry } from "flow-core/registries/step-registry";
import { logError } from "flow-core/utils/logger";
import {
	FS_FEATURE_SYSTEM_PROMPT as CORE_FS_FEATURE_SYSTEM_PROMPT,
	FS_FEATURE_TOOLS,
} from "flow-core/steps/features/fs-feature";

const STEP_NAME = "fs-feature" as const;

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

const MEMORALL_NAMESPACE_PROMPT = `
## MEMORALL FILESYSTEM NAMESPACES
These rules are specific to the Memorall host runtime and override generic path guidance above.

| Namespace | Root path | Backing path | Purpose |
|---|---|---|---|
| Documents | \`/documents\` | \`/home/documents\` | User documents, notes, PDFs, and other files |
| Workspaces | \`/workspaces\` | \`/home/workspaces\` | Code projects, scripts, and workspace files |

Always prefix paths with the appropriate namespace root:
- Documents: \`/documents/notes/todo.md\`
- Workspaces: \`/workspaces/myproject/src/index.ts\`

Start exploration with \`fs_ls\` on \`/documents\` or \`/workspaces\`.
Scope broad searches and globs to a namespace root whenever possible.
Both namespaces are persistent. When unsure, prefer \`/documents\` for user content and \`/workspaces\` for code.
`;

export const FS_FEATURE_SYSTEM_PROMPT = [
	CORE_FS_FEATURE_SYSTEM_PROMPT,
	MEMORALL_NAMESPACE_PROMPT.trim(),
].join("\n\n");

export { FS_FEATURE_TOOLS };

export const FS_FEATURE_DESCRIPTION =
	"Enable filesystem tools with access to both /documents and /workspaces namespaces: glob, grep, read, write, edit, mkdir, remove, ls.";

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
	version: "2.0.0",
	description: FS_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: true,
	feature: {
		id: "step-fs-feature",
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
				description: "Messages with filesystem namespace instructions",
			},
			{
				name: "tools",
				type: "Tool[]",
				description:
					"Tools extended with fs toolset (/documents + /workspaces)",
			},
		],
	},
});
