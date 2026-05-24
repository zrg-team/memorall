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

const inputSchema = z.object({
	selector: z
		.string()
		.optional()
		.describe(
			"Stable CSS selector for the text input or textarea. Use co_agent_observe or co_agent_query first to get this value.",
		),
	index: z
		.number()
		.optional()
		.describe(
			"Zero-based element index when selector matches multiple elements.",
		),
	value: z
		.string()
		.optional()
		.describe(
			"Text to type into the selected input. Defaults to an empty string.",
		),
	message: z
		.string()
		.optional()
		.describe(
			"Short user-facing reason for the input action, shown when confirmation is needed.",
		),
});

type InputInput = z.infer<typeof inputSchema>;

const createInputTool: ToolFactory<InputInput> = (): Tool<InputInput> => ({
	name: "co_agent_input",
	description:
		"Safely type text into a selected text input or textarea in the active co-agent tab. Sensitive fields are blocked.",
	schema: inputSchema,
	execute: async (input) => {
		try {
			const selector = optionalTrimmedString(input.selector);
			if (!selector) {
				return createToolInputErrorResult(
					"co_agent_input",
					"No selector was provided for co_agent_input. Use co_agent_observe or co_agent_query first to get a stable selector.",
				);
			}
			const value =
				typeof input.value === "string"
					? input.value
					: input.value === undefined || input.value === null
						? ""
						: String(input.value);
			const index = normalizeIndex(input.index);
			const message = optionalTrimmedString(input.message);
			const response = await sendCoAgentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:input",
				selector,
				index,
				value,
				message,
			});
			return createResult({
				actionType: "co_agent_input",
				selector,
				...response,
			});
		} catch (error) {
			return createDefaultErrorResult(error);
		}
	},
});

toolRegistry.register("co_agent_input", createInputTool);

declare global {
	interface ToolTypeRegistry {
		co_agent_input: {
			input: InputInput;
			services: void;
		};
	}
}
