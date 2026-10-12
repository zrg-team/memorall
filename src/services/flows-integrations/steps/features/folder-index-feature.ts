import {
	GraphBase,
	type GraphTool,
} from "@memorall/agent-harness-flows/graph/graph.base";
import type { ChatCompletionMessageParam } from "@memorall/agent-harness-flows/interfaces/engine/messages";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import {
	bindStep,
	defineStep,
} from "@memorall/agent-harness-flows/interfaces/engine/step";
import { logError } from "@memorall/agent-harness-flows/logging/logger";
import {
	stepRegistry,
	type StepFeatureMetadata,
} from "@memorall/agent-harness-flows/registries/step-registry";
import {
	FOLDER_INDEX_STEP_NAME,
	FILE_OKF_INDEX_FEATURE_ID,
	FILE_OKF_INDEX_STEP_NAME,
	FILE_EMBEDDING_INDEX_FEATURE_ID,
	FILE_EMBEDDING_INDEX_STEP_NAME,
} from "@/services/folder-index/constants";
import {
	FOLDER_INDEX_TYPES,
	OKF_INDEX_TYPE,
	EMBEDDING_INDEX_TYPE,
} from "@/services/folder-index/index-types";

const STEP_NAME = FOLDER_INDEX_STEP_NAME;

export interface FolderIndexFeatureInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
}

export interface FolderIndexFeatureOutput {
	tools?: GraphTool[];
	messages?: ChatCompletionMessageParam[];
}

export type FolderIndexFeatureConfig = Record<string, never>;

export type FolderIndexFeatureServices = Record<string, never>;

/**
 * Lets the agent search folders through their indexes. Which folders have
 * which index types is set in Files; this only gives the agent the tools.
 * Every index type brings its own tools and instructions, so a new type
 * reaches the agent without a change here. Separate from the file tools:
 * nothing here reads or writes the user's files.
 */
export const FOLDER_INDEX_FEATURE_SYSTEM_PROMPT = [
	`# FOLDER INDEXES
The user keeps indexes of some folders: data about each file that is faster to search than the files. They choose the folders in Files › Indexes. Use the index tools below to find and understand files; they read only the indexes and never change the user's files.`,
	...FOLDER_INDEX_TYPES.map((type) => type.prompt),
].join("\n\n");

export const FOLDER_INDEX_FEATURE_TOOLS: string[] = FOLDER_INDEX_TYPES.flatMap(
	(type) => [...type.tools],
);

export const FOLDER_INDEX_FEATURE_DESCRIPTION =
	"Search folders through OKF cards and EmbeddingGemma 2 content chunks, including images, audio, music and video.";

export const FILE_OKF_INDEX_FEATURE_TOOLS = [...OKF_INDEX_TYPE.tools];
export const FILE_EMBEDDING_INDEX_FEATURE_TOOLS = [
	...EMBEDDING_INDEX_TYPE.tools,
];
export const FILE_OKF_INDEX_FEATURE_DESCRIPTION =
	"Find files through their Open Knowledge Format cards, summaries, types and tags.";
export const FILE_EMBEDDING_INDEX_FEATURE_DESCRIPTION =
	"Find document passages, images, audio, music and video by meaning using local content embeddings.";
export const FILE_OKF_INDEX_FEATURE_SYSTEM_PROMPT = `# FILE OKF INDEXES\nThe user enables OKF indexes in Files › Indexes. These tools read the indexed cards and never change source files.\n\n${OKF_INDEX_TYPE.prompt}`;
export const FILE_EMBEDDING_INDEX_FEATURE_SYSTEM_PROMPT =
	EMBEDDING_INDEX_TYPE.prompt;

const defineIndexFeature = (
	name: string,
	featureTools: string[],
	prompt: string,
) =>
	defineStep<
		FolderIndexFeatureInput,
		FolderIndexFeatureOutput,
		FolderIndexFeatureServices,
		FolderIndexFeatureConfig
	>({
		name,
		execute: async ({ input }) => {
			try {
				const tools = GraphBase.chat.addTool(
					input.tools,
					...(featureTools as GraphTool[]),
				);
				const messages = GraphBase.chat.systemMessage(input.messages, prompt);
				return { output: { tools, messages } };
			} catch (error) {
				logError("[FOLDER_INDEX_FEATURE] Failed:", error);
				return {
					output: {
						tools: input.tools,
						messages: input.messages,
						errors: [
							error instanceof Error
								? error.message
								: "Folder index feature step failed",
						],
					},
				};
			}
		},
	});

// The combined runtime step remains readable for old custom graphs; new agents
// and saved configurations use the two independent feature steps below.
const definition = defineIndexFeature(
	STEP_NAME,
	FOLDER_INDEX_FEATURE_TOOLS,
	FOLDER_INDEX_FEATURE_SYSTEM_PROMPT,
);
const okfDefinition = defineIndexFeature(
	FILE_OKF_INDEX_STEP_NAME,
	FILE_OKF_INDEX_FEATURE_TOOLS,
	FILE_OKF_INDEX_FEATURE_SYSTEM_PROMPT,
);
const embeddingDefinition = defineIndexFeature(
	FILE_EMBEDDING_INDEX_STEP_NAME,
	FILE_EMBEDDING_INDEX_FEATURE_TOOLS,
	FILE_EMBEDDING_INDEX_FEATURE_SYSTEM_PROMPT,
);

type FolderIndexFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createFolderIndexFeatureStep: StepFactoryFromSpec<
	FolderIndexFeatureSpec
> = (services: FolderIndexFeatureServices, config?: FolderIndexFeatureConfig) =>
	bindStep(definition, services, config);

type FileOkfIndexFeatureSpec = StepSpecFromDefinition<typeof okfDefinition>;
type FileEmbeddingIndexFeatureSpec = StepSpecFromDefinition<
	typeof embeddingDefinition
>;
export const createFileOkfIndexFeatureStep: StepFactoryFromSpec<
	FileOkfIndexFeatureSpec
> = (services, config) => bindStep(okfDefinition, services, config);
export const createFileEmbeddingIndexFeatureStep: StepFactoryFromSpec<
	FileEmbeddingIndexFeatureSpec
> = (services, config) => bindStep(embeddingDefinition, services, config);

stepRegistry.register(STEP_NAME, createFolderIndexFeatureStep, {
	version: "1.0.0",
	description: FOLDER_INDEX_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
});

const indexFeatureMetadata: StepFeatureMetadata = {
	type: "feature",
	graphTypes: ["foundation", "agent"],
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
			description: "Messages with instructions for reading folder indexes",
		},
		{
			name: "tools",
			type: "Tool[]",
			description: "Tools extended with this index type's tools",
		},
	],
};

stepRegistry.register(FILE_OKF_INDEX_STEP_NAME, createFileOkfIndexFeatureStep, {
	version: "1.0.0",
	description: FILE_OKF_INDEX_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: { ...indexFeatureMetadata, id: FILE_OKF_INDEX_FEATURE_ID },
});
stepRegistry.register(
	FILE_EMBEDDING_INDEX_STEP_NAME,
	createFileEmbeddingIndexFeatureStep,
	{
		version: "1.0.0",
		description: FILE_EMBEDDING_INDEX_FEATURE_DESCRIPTION,
		defaultStateMapping: { messages: "messages", tools: "tools" },
		enabledByDefault: false,
		feature: { ...indexFeatureMetadata, id: FILE_EMBEDDING_INDEX_FEATURE_ID },
	},
);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: FolderIndexFeatureSpec;
		[FILE_OKF_INDEX_STEP_NAME]: FileOkfIndexFeatureSpec;
		[FILE_EMBEDDING_INDEX_STEP_NAME]: FileEmbeddingIndexFeatureSpec;
	}
}
