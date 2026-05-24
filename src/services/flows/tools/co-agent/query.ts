import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { CO_AGENT_CONTENT_COMMAND_SOURCE } from "@/services/co-agent";
import {
	createDefaultErrorResult,
	createResult,
	normalizePositiveInteger,
	optionalTrimmedString,
	sendCoAgentCommand,
} from "./shared";

const querySchema = z.object({
	selector: z
		.string()
		.optional()
		.describe(
			"CSS selector to query in the active tab. Defaults to body when omitted or blank.",
		),
	maxResults: z
		.number()
		.optional()
		.describe("Maximum number of matching elements to return."),
});

type QueryInput = z.infer<typeof querySchema>;

const createQueryTool: ToolFactory<QueryInput> = (): Tool<QueryInput> => ({
	name: "co_agent_query",
	description:
		"Query DOM elements in the active co-agent tab. Returns visible state, rects, stable selectors, text/value, and input capability.",
	schema: querySchema,
	execute: async (input) => {
		try {
			const selector = optionalTrimmedString(input.selector) ?? "body";
			const maxResults = normalizePositiveInteger(input.maxResults);
			const response = await sendCoAgentCommand({
				source: CO_AGENT_CONTENT_COMMAND_SOURCE,
				type: "co-agent:query",
				selector,
				maxResults,
			});
			return createResult({
				actionType: "co_agent_query",
				selector,
				...response,
			});
		} catch (error) {
			return createDefaultErrorResult(error);
		}
	},
});

toolRegistry.register("co_agent_query", createQueryTool);

declare global {
	interface ToolTypeRegistry {
		co_agent_query: {
			input: QueryInput;
			services: void;
		};
	}
}
