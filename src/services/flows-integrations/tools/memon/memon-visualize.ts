import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import {
	MEMON_VISUALIZE_TOOL,
	memonDisplayPath,
} from "@/services/memon/constants";
import { OPENUI_COMPONENTS_TEXT } from "../../steps/features/visualize-response/components";
import { OPENUI_LANGUAGE_GUIDE } from "../../steps/features/visualize-response/prompt";
import { runMemonTool } from "./memon-tool-utils";

/**
 * The whole OpenUI Lang reference. The prompt keeps a short version; the
 * agent reads this once, when it is about to write a visual.
 */
const OPENUI_REFERENCE = `${OPENUI_LANGUAGE_GUIDE}

Supported components:
${OPENUI_COMPONENTS_TEXT}`;

const schema = z
	.object({
		openui: z
			.string()
			.optional()
			.describe(
				'The visual in OpenUI Lang: root = CardBlock("Title", "Description", [section_1, …]) first, then one line per section.',
			),
		guide: z
			.boolean()
			.optional()
			.describe(
				"true: return the OpenUI Lang reference (every component's arguments and the rules) instead of showing a visual. Read it once before your first visual.",
			),
		title: z
			.string()
			.optional()
			.describe("Its name; the root CardBlock's title by default."),
		path: z
			.string()
			.optional()
			.describe(
				"Where to keep it (.openui). Default: ~/Visuals/<title>.openui; the visual on screen is updated in place.",
			),
	})
	.describe(
		"Show the user a visual in the Visualize app and keep it as a file.",
	);

type Input = z.infer<typeof schema>;

export const createMemonVisualizeTool: ToolFactory<
	Input
> = (): Tool<Input> => ({
	name: MEMON_VISUALIZE_TOOL,
	description:
		"Show the user a visual (dashboard, report, comparison, chart, table, form) written in OpenUI Lang in the Visualize app, saved as a .openui file they can open again. Returns the screen.",
	schema,
	execute: async (input, context) => {
		if (input.guide) return { content: OPENUI_REFERENCE };
		return runMemonTool(
			MEMON_VISUALIZE_TOOL,
			context,
			`Visualizing ${input.title ?? "a visual"}`,
			(machine) => ({ windowId: machine.findWindow("visualize")?.id }),
			async (machine) => {
				if (!input.openui?.trim()) {
					throw new Error(
						"Give the visual in openui, or guide: true for the OpenUI Lang reference.",
					);
				}
				const path = await machine.showVisual(input.openui, {
					path: input.path,
					title: input.title,
				});
				return `Showed it in Visualize and saved it to ${memonDisplayPath(path, machine.home)}.`;
			},
		);
	},
});

toolRegistry.register(MEMON_VISUALIZE_TOOL, createMemonVisualizeTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_VISUALIZE_TOOL]: { input: Input; services: void };
	}
}
