import {
	defineStep,
	bindStep,
} from "@/services/flows-core/interfaces/engine/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows-core/interfaces/engine/step";
import {
	GraphBase,
	type ConfiguredGraphTool,
	type GraphTool,
} from "@/services/flows-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/services/flows-core/interfaces/engine/messages";
import { stepRegistry } from "@/services/flows-core/registries/step-registry";
import { logError } from "@/services/flows-core/utils/logger";
import type { FsToolConfig } from "@/services/flows-core/tools/fs/config";
import {
	FS_FEATURE_SYSTEM_PROMPT as CORE_FS_FEATURE_SYSTEM_PROMPT,
	FS_FEATURE_TOOLS,
} from "@/services/flows-core/steps/features/fs-feature";
import { memorallFsToolConfig } from "flow-integrations/tools/fs/memorall-fs-path-policy";

const STEP_NAME = "fs-feature" as const;

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

const MEMORALL_NAMESPACE_PROMPT = `
## MEMORALL FILESYSTEM ROOT
These rules are specific to the Memorall host runtime and override generic path guidance above.

Memorall exposes one persistent filesystem rooted at \`/\`.

Use normal absolute paths:
- Documents, notes, PDFs, and reports: \`/notes/todo.md\`, \`/finance/report.md\`
- Code projects and generated apps: \`/projects/myproject/src/index.ts\`

Start exploration with \`fs_ls\` on \`/\`.
Scope broad searches and globs to the most relevant folder whenever possible.
All paths are persistent. When creating code projects, prefer \`/projects/<slug>\`.
`;

export const FS_FEATURE_SYSTEM_PROMPT = [
	CORE_FS_FEATURE_SYSTEM_PROMPT,
	MEMORALL_NAMESPACE_PROMPT.trim(),
].join("\n\n");

export { FS_FEATURE_TOOLS };

export const FS_FEATURE_DESCRIPTION =
	"Enable filesystem tools with root access: glob, grep, read, write, edit, mkdir, remove, ls.";

const definition = defineStep<
	FsFeatureInput,
	FsFeatureOutput,
	FsFeatureServices,
	FsFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config }) => {
		try {
			const toolConfig: FsToolConfig = {
				...memorallFsToolConfig,
				...config,
			};
			const configuredTools = FS_FEATURE_TOOLS.map(
				(name): ConfiguredGraphTool<FsToolConfig> => ({
					name,
					config: toolConfig,
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
				description: "Tools extended with root filesystem toolset",
			},
		],
	},
});
