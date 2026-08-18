import type { DynamicStructuredTool } from "@langchain/core/tools";
import {
	jsonToolSchema,
	type BaseTool,
	type ToolExecutionResult,
	type ToolResultValue,
} from "@/services/flows-core/interfaces/engine/tool";
import { z } from "zod";

type MCPToolRuntimeMetadata = {
	source: "mcp";
	mcp: {
		serverName: string;
		originalToolName: string;
		title?: string;
		outputSchema?: Record<string, unknown>;
		icons?: Array<{ src: string; mimeType?: string; sizes?: string[] }>;
		annotations?: Record<string, unknown>;
	};
};

const parseRichMcpResult = (value: string): ToolExecutionResult | undefined => {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		if (
			parsed.structuredContent === undefined &&
			parsed.meta === undefined &&
			parsed.content === undefined
		) {
			return undefined;
		}
		return {
			content:
				typeof parsed.text === "string"
					? parsed.text
					: parsed.content === undefined
						? ""
						: JSON.stringify(parsed.content),
			structuredContent: parsed.structuredContent,
			meta:
				typeof parsed.meta === "object" && parsed.meta !== null
					? (parsed.meta as Record<string, unknown>)
					: undefined,
		};
	} catch {
		return undefined;
	}
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
		title: metadata?.mcp.title,
		description: tool.description,
		schema,
		outputSchema: metadata?.mcp.outputSchema,
		icons: metadata?.mcp.icons,
		annotations: metadata?.mcp.annotations,
		metadata,
		execute: async (input: unknown): Promise<ToolResultValue> => {
			const result = await tool.invoke(input as Record<string, unknown>);
			if (typeof result !== "string") return JSON.stringify(result);
			return parseRichMcpResult(result) ?? result;
		},
	};
}
