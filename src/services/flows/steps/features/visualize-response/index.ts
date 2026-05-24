import { defineStep, bindStep } from "../../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../../interfaces/step";
import { stepRegistry } from "../../../step-registry";
import {
	FEATURE_DEFAULT_INPUTS,
	FEATURE_DEFAULT_OUTPUTS,
	featureCatalogRegistry,
	type FeatureCatalogMetadata,
} from "../../../feature-catalog-registry";
import { GraphBase, type GraphTool } from "../../../graph/graph.base";
import type { ChatCompletionMessageParam } from "../../../interfaces/messages";
import { getFlowRuntimeVars } from "../../../runtime/runtime-context";
import { OPENUI_KNOWLEDGE_TOOLS } from "../../../tools/openui-knowledge";
import {
	OPENUI_SYSTEM_PROMPT,
	OPENUI_WIREFRAME_THEME_INSTRUCTION,
	OPENUI_GLASS_THEME_INSTRUCTION,
} from "./prompt";
import { logError } from "../../../interfaces/logger";

const STEP_NAME = "visualize-response" as const;
export const VISUALIZE_RESPONSE_FEATURE_NAME = STEP_NAME;

const OPENUI_KNOWLEDGE_GRAPH_TOOLS: GraphTool[] = [...OPENUI_KNOWLEDGE_TOOLS];

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

			const tools = GraphBase.chat.addTool(
				input.tools ?? [],
				...OPENUI_KNOWLEDGE_GRAPH_TOOLS,
			);
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
});

featureCatalogRegistry.register({
	id: "step-visualize-response",
	name: VISUALIZE_RESPONSE_FEATURE_NAME,
	type: "feature",
	graphTypes: ["foundation", "agent"],
	inputs: FEATURE_DEFAULT_INPUTS,
	outputs: FEATURE_DEFAULT_OUTPUTS,
	metadata: {
		description: VISUALIZE_RESPONSE_FEATURE_DESCRIPTION,
		descriptionKey: "flowBuilder.features.visualizeResponse.description",
		displayName: "Visualize Response",
		nameKey: "flowBuilder.features.visualizeResponse.name",
		tools: [...OPENUI_KNOWLEDGE_TOOLS],
		systemPrompt: OPENUI_SYSTEM_PROMPT,
		customizable: false,
		icon: { name: "PanelsTopLeft", type: "lucide" },
		accentColor: "#0ea5e9",
		section: "core",
		sectionOrder: 8,
		detailView: [{ component: "VisualizeResponseConfig" }],
	} satisfies FeatureCatalogMetadata,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: VisualizeResponseSpec;
	}
}
