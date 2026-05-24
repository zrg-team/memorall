import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/services/co-agent";
import {
	createDefaultErrorResult,
	createResult,
	normalizeIndex,
	optionalNumber,
	optionalOneOf,
	optionalTrimmedString,
	sendCoAgentCommand,
} from "./shared";

const scrollSchema = z.object({
	selector: z
		.string()
		.optional()
		.describe(
			"Stable CSS selector for a scrollable element. Leave empty to scroll the page window.",
		),
	index: z
		.number()
		.optional()
		.describe(
			"Zero-based element index when selector matches multiple elements.",
		),
	deltaX: z.number().optional().describe("Horizontal scroll delta in pixels."),
	deltaY: z.number().optional().describe("Vertical scroll delta in pixels."),
	top: z
		.number()
		.optional()
		.describe("Absolute vertical scroll position in pixels."),
	left: z
		.number()
		.optional()
		.describe("Absolute horizontal scroll position in pixels."),
	behavior: z
		.string()
		.optional()
		.describe(
			"Scroll behavior: auto or smooth. Defaults to page handler behavior.",
		),
	message: z
		.string()
		.optional()
		.describe("Short label or explanation for the scroll action."),
});

type ScrollInput = z.infer<typeof scrollSchema>;

const createScrollTool: ToolFactory<ScrollInput> = (): Tool<ScrollInput> => ({
	name: "co_agent_scroll",
	description:
		"Scroll the active co-agent tab window or a selected scrollable element.",
	schema: scrollSchema,
	execute: async (input) => {
		try {
			const response = await sendCoAgentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:scroll",
				selector: optionalTrimmedString(input.selector),
				index: normalizeIndex(input.index),
				deltaX: optionalNumber(input.deltaX),
				deltaY: optionalNumber(input.deltaY),
				top: optionalNumber(input.top),
				left: optionalNumber(input.left),
				behavior: optionalOneOf(input.behavior, ["auto", "smooth"] as const),
				message: optionalTrimmedString(input.message),
			});
			return createResult({ actionType: "co_agent_scroll", ...response });
		} catch (error) {
			return createDefaultErrorResult(error);
		}
	},
});

toolRegistry.register("co_agent_scroll", createScrollTool);

declare global {
	interface ToolTypeRegistry {
		co_agent_scroll: {
			input: ScrollInput;
			services: void;
		};
	}
}
