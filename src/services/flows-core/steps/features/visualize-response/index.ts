import {
	defineStep,
	bindStep,
} from "@/services/flows-core/interfaces/engine/step";
import type {
	BoundStep,
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "@/services/flows-core/interfaces/engine/step";
import { stepRegistry } from "@/services/flows-core/registries/step-registry";
import {
	GraphBase,
	type GraphTool,
} from "@/services/flows-core/graph/graph.base";
import type { ChatCompletionMessageParam } from "@/services/flows-core/interfaces/engine/messages";
import { getFlowRuntimeVars } from "@/services/flows-core/runtime/runtime-context";
import {
	OPENUI_SYSTEM_PROMPT,
	OPENUI_WIREFRAME_THEME_INSTRUCTION,
	OPENUI_GLASS_THEME_INSTRUCTION,
} from "@/services/flows-core/steps/features/visualize-response/prompt";
import { logError } from "@/services/flows-core/utils/logger";

const STEP_NAME = "visualize-response" as const;
export const VISUALIZE_RESPONSE_FEATURE_NAME = STEP_NAME;

export interface VisualizeResponseInput {
	messages: ChatCompletionMessageParam[];
	tools: GraphTool[];
	graphId?: string;
}

export interface VisualizeResponseOutput {
	messages?: ChatCompletionMessageParam[];
	tools?: GraphTool[];
	errors?: string[];
}

type VisualizeResponseServices = Record<string, never>;

export type OpenUITheme = "shadcn" | "wireframe" | "glass";

export interface VisualizeResponseConfig {
	theme?: OpenUITheme;
}

export const VISUALIZE_RESPONSE_FEATURE_DESCRIPTION =
	"Enables OpenUI Lang responses with interactive components and knowledge graph data tools.";

const definition = defineStep<
	VisualizeResponseInput,
	VisualizeResponseOutput,
	VisualizeResponseServices,
	VisualizeResponseConfig
>({
	name: STEP_NAME,
	execute: async ({ input, config, runConfig }) => {
		try {
			const runtimeVars = getFlowRuntimeVars(runConfig);

			const graphId = input.graphId?.trim();
			if (graphId) {
				runtimeVars?.set("graph.id", graphId);
			}

			if (config?.theme) {
				runtimeVars?.set("openui.theme", config.theme);
			}

			const theme = config?.theme ?? "shadcn";
			const themeInstruction =
				theme === "wireframe"
					? OPENUI_WIREFRAME_THEME_INSTRUCTION
					: theme === "glass"
						? OPENUI_GLASS_THEME_INSTRUCTION
						: null;
			const systemPrompt = themeInstruction
				? `${OPENUI_SYSTEM_PROMPT}\n\n${themeInstruction}`
				: OPENUI_SYSTEM_PROMPT;

			const tools = input.tools ?? [];
			const messages = GraphBase.chat.systemMessage(
				input.messages ?? [],
				systemPrompt,
			);

			return { output: { messages, tools } };
		} catch (error) {
			logError("[VISUALIZE_RESPONSE] Failed:", error);
			return {
				output: {
					messages: input.messages,
					tools: input.tools,
					errors: [
						error instanceof Error
							? error.message
							: "Visualize response feature step failed",
					],
				},
			};
		}
	},
});

type VisualizeResponseSpec = StepSpecFromDefinition<typeof definition>;

export const createVisualizeResponseStep: StepFactoryFromSpec<
	VisualizeResponseSpec
> = (services: VisualizeResponseServices, config?: VisualizeResponseConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createVisualizeResponseStep, {
	description: VISUALIZE_RESPONSE_FEATURE_DESCRIPTION,
	defaultStateMapping: {
		messages: "messages",
		tools: "tools",
		graphId: "graphId",
	},
	enabledByDefault: false,
	feature: {
		id: "step-visualize-response",
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
				description: "Messages updated by the feature.",
			},
			{
				name: "tools",
				type: "Tool[]",
				description: "Tools extended by the feature.",
			},
		],
	},
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: VisualizeResponseSpec;
	}
}
