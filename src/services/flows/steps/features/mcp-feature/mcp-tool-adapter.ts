import type { DynamicStructuredTool } from "@langchain/core/tools";
import {
	jsonToolSchema,
	type BaseTool,
	type ToolResultValue,
} from "../../../interfaces/tool";
import { z } from "zod";

type MCPToolRuntimeMetadata = {
	source: "mcp";
	mcp: {
		serverName: string;
		originalToolName: string;
	};
};

export function adaptMCPTool(tool: DynamicStructuredTool): BaseTool {
	const rawSchema = tool.schema;
	const schema =
		rawSchema && typeof (rawSchema as z.ZodSchema).safeParse === "function"
			? (rawSchema as z.ZodSchema)
			: jsonToolSchema(
					typeof rawSchema === "object" && rawSchema !== null
						? (rawSchema as Record<string, unknown>)
						: { type: "object", properties: {} },
				);
	const metadata = (
		tool as DynamicStructuredTool & {
			metadata?: MCPToolRuntimeMetadata;
		}
	).metadata;

	return {
		name: tool.name,
		description: tool.description,
		schema,
		metadata,
		execute: async (input: unknown): Promise<ToolResultValue> => {
			const result = await tool.invoke(input as Record<string, unknown>);
			return typeof result === "string" ? result : JSON.stringify(result);
		},
	};
}
