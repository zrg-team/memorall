import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/services/co-agent";
import {
	createDefaultErrorResult,
	createResult,
	createToolInputErrorResult,
	normalizeIndex,
	optionalTrimmedString,
	sendCoAgentCommand,
} from "./shared";

const clickSchema = z.object({
	selector: z
		.string()
		.optional()
		.describe(
			"Stable CSS selector for the element to click. Use co_agent_observe or co_agent_query first to get this value.",
		),
	index: z
		.number()
		.optional()
		.describe(
			"Zero-based element index when selector matches multiple elements.",
		),
	message: z
		.string()
		.optional()
		.describe(
			"Short user-facing reason for the click, shown when confirmation is needed.",
		),
});

type ClickInput = z.infer<typeof clickSchema>;

const createClickTool: ToolFactory<ClickInput> = (): Tool<ClickInput> => ({
	name: "co_agent_click",
	description:
		"Safely click a selected element in the active co-agent tab. High-impact or sensitive targets are blocked and require user action.",
	schema: clickSchema,
	execute: async (input) => {
		try {
			const selector = optionalTrimmedString(input.selector);
			if (!selector) {
				return createToolInputErrorResult(
					"co_agent_click",
					"No selector was provided for co_agent_click. Use co_agent_observe or co_agent_query first to get a stable selector.",
				);
			}
			const index = normalizeIndex(input.index);
			const message = optionalTrimmedString(input.message);
			const response = await sendCoAgentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:click",
				selector,
				index,
				message,
			});
			return createResult({
				actionType: "co_agent_click",
				selector,
				...response,
			});
		} catch (error) {
			return createDefaultErrorResult(error);
		}
	},
});

toolRegistry.register("co_agent_click", createClickTool);

declare global {
	interface ToolTypeRegistry {
		co_agent_click: {
			input: ClickInput;
			services: void;
		};
	}
}
