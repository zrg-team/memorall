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
import { stepRegistry } from "@memorall/agent-harness-flows/registries/step-registry";
import {
	FOLDER_INDEX_FEATURE_ID,
	FOLDER_INDEX_STEP_NAME,
} from "@/services/folder-index/constants";
import { FOLDER_INDEX_TYPES } from "@/services/folder-index/index-types";

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
	"Search folders through their indexes. Supports OKF; more index types can be added.";

const definition = defineStep<
	FolderIndexFeatureInput,
	FolderIndexFeatureOutput,
	FolderIndexFeatureServices,
	FolderIndexFeatureConfig
>({
	name: STEP_NAME,
	execute: async ({ input }) => {
		try {
			const tools = GraphBase.chat.addTool(
				input.tools,
				...(FOLDER_INDEX_FEATURE_TOOLS as GraphTool[]),
			);
			const messages = GraphBase.chat.systemMessage(
				input.messages,
				FOLDER_INDEX_FEATURE_SYSTEM_PROMPT,
			);
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

type FolderIndexFeatureSpec = StepSpecFromDefinition<typeof definition>;

export const createFolderIndexFeatureStep: StepFactoryFromSpec<
	FolderIndexFeatureSpec
> = (services: FolderIndexFeatureServices, config?: FolderIndexFeatureConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createFolderIndexFeatureStep, {
	version: "1.0.0",
	description: FOLDER_INDEX_FEATURE_DESCRIPTION,
	defaultStateMapping: { messages: "messages", tools: "tools" },
	enabledByDefault: false,
	feature: {
		id: FOLDER_INDEX_FEATURE_ID,
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
				description: "Tools extended with the tools of every index type",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: FolderIndexFeatureSpec;
	}
}
