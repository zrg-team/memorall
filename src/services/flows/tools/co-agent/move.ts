import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/services/co-agent";
import {
	createDefaultErrorResult,
	createResult,
	createToolInputErrorResult,
	normalizeIndex,
	optionalBoolean,
	optionalNumber,
	optionalOneOf,
	optionalTrimmedString,
	sendCoAgentCommand,
} from "./shared";

const moveSchema = z.object({
	selector: z
		.string()
		.optional()
		.describe(
			"Stable CSS selector for the element to point at. Use co_agent_observe or co_agent_query first to get this value.",
		),
	index: z
		.number()
		.optional()
		.describe(
			"Zero-based element index when selector matches multiple elements.",
		),
	x: z
		.number()
		.optional()
		.describe("Viewport x coordinate to point at when no selector is used."),
	y: z
		.number()
		.optional()
		.describe("Viewport y coordinate to point at when no selector is used."),
	scrollIntoView: z
		.boolean()
		.optional()
		.describe(
			"Whether to scroll the selected element into view before pointing.",
		),
	message: z
		.string()
		.optional()
		.describe("Short label or explanation to show near the co-agent cursor."),
	mode: z
		.string()
		.optional()
		.describe(
			"Cursor movement mode: moveTo or jumpTo. Defaults to the page handler behavior.",
		),
});

type MoveInput = z.infer<typeof moveSchema>;

const createMoveTool: ToolFactory<MoveInput> = (): Tool<MoveInput> => ({
	name: "co_agent_move",
	description:
		"Move the visible co-agent cursor to a selector/index or viewport coordinates. Optionally scroll the element into view.",
	schema: moveSchema,
	execute: async (input) => {
		try {
			const selector = optionalTrimmedString(input.selector);
			const x = optionalNumber(input.x);
			const y = optionalNumber(input.y);
			if (!selector && (x === undefined || y === undefined)) {
				return createToolInputErrorResult(
					"co_agent_move",
					"Provide a selector or both x and y for co_agent_move. Use co_agent_observe or co_agent_query first to get a stable selector.",
				);
			}
			const mode = optionalOneOf(input.mode, ["moveTo", "jumpTo"] as const);
			const response = await sendCoAgentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:move",
				selector,
				index: normalizeIndex(input.index),
				point: x !== undefined && y !== undefined ? { x, y } : undefined,
				scrollIntoView: optionalBoolean(input.scrollIntoView),
				message: optionalTrimmedString(input.message),
				mode,
			});
			return createResult({ actionType: "co_agent_move", ...response });
		} catch (error) {
			return createDefaultErrorResult(error);
		}
	},
});

toolRegistry.register("co_agent_move", createMoveTool);

declare global {
	interface ToolTypeRegistry {
		co_agent_move: {
			input: MoveInput;
			services: void;
		};
	}
}
