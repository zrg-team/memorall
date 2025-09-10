import type { BaseTool, AllServices } from "../interfaces/tool";
import { calculatorTool } from "./calculator";
import { currentTimeTool } from "./current-time";
import { knowledgeGraphTool } from "./knowledge-graph";
import { memorySearchTool } from "./memory-search";

export const availableTools = {
	calculator: calculatorTool,
	memory_search: memorySearchTool,
	current_time: currentTimeTool,
	knowledge_graph: knowledgeGraphTool,
} as const;

// Helper to get tool by name with proper types
export function getTool(name: string): BaseTool<any> | undefined {
	return availableTools[name as keyof typeof availableTools];
}

// Generic type-safe tool execution with function introspection
export async function executeToolByName(
	toolName: string,
	args: any,
	services: AllServices,
): Promise<string> {
	const tool = availableTools[toolName as keyof typeof availableTools];
	if (!tool) {
		throw new Error(`Tool '${toolName}' not found`);
	}

	// Validate arguments with tool schema
	const validatedArgs = tool.schema.parse(args);

	// Check how many parameters the execute function expects
	const executeFunction = tool.execute as Function;
	const parameterCount = executeFunction.length;

	if (parameterCount === 1) {
		// Tool only expects input, no services
		return executeFunction.call(tool, validatedArgs);
	} else if (parameterCount === 2) {
		// Tool expects input and services
		return executeFunction.call(tool, validatedArgs, services);
	} else {
		throw new Error(
			`Unexpected parameter count ${parameterCount} for tool ${toolName}`,
		);
	}
}

// Helper to get all tool names
export function getToolNames(): string[] {
	return Object.keys(availableTools);
}

// Helper to format tools for LLM consumption
export function formatToolsForLLM(
	inputTools: Record<string, BaseTool>,
): string {
	return Object.values(inputTools)
		.map((tool) => `${tool.name}: ${tool.description}`)
		.join("\n");
}

// Convert tool schema to parameter description
function formatToolParameters(schema: any): string {
	const shape = schema._def?.shape;
	if (!shape) return "";

	const params: string[] = [];
	for (const [key, value] of Object.entries(shape)) {
		const fieldSchema = value as any;
		const isOptional = fieldSchema._def?.typeName === "ZodOptional";
		const description =
			fieldSchema._def?.description ||
			(isOptional ? fieldSchema._def?.innerType?._def?.description : undefined);
		const type = isOptional
			? fieldSchema._def?.innerType?._def?.typeName
			: fieldSchema._def?.typeName;

		let paramStr = key;
		if (isOptional) paramStr += "?";
		if (description) paramStr += ` (${description})`;
		if (type === "ZodEnum") {
			const values = isOptional
				? fieldSchema._def?.innerType?._def?.values
				: fieldSchema._def?.values;
			if (values) paramStr += ` [${values.join("|")}]`;
		}

		params.push(paramStr);
	}

	return params.join(", ");
}

// Generate tool calling instructions for system prompt
export function generateToolInstructions(
	tools: Partial<typeof availableTools>,
): string {
	const toolList = Object.values(tools)
		.map((tool) => {
			const params = formatToolParameters(tool.schema);
			return `- ${tool.name}: ${tool.description}${params ? `. Parameters: ${params}` : ""}`;
		})
		.join("\n");

	return `Available tools:
${toolList}

To use a tool, respond with Python function call format in a single line:
tool_name(param1="value1", param2="value2")

Example:
current_time(timezone="America/New_York")

Important: Must respond with a exactly one line functionc call and nothing else.
`;
}

// Type-safe tool execution that preserves generic types
export function executeToolSafely(
	tool: BaseTool<void>,
	args: any,
): Promise<string>;
export function executeToolSafely<S>(
	tool: BaseTool<S>,
	args: any,
	services: S,
): Promise<string>;
export function executeToolSafely(
	tool: any,
	args: any,
	services?: any,
): Promise<string> {
	return tool.execute(args, services);
}

// Parse tool call from LLM response (Python function call format)
export function parseToolCall(
	response: string,
): { name: string; arguments: Record<string, any> } | null {
	// Match Python function call format: tool_name(param1="value1", param2="value2")
	const toolCallMatch = response.match(/(\w+)\s*\(([^)]*)\)/);
	if (!toolCallMatch) return null;

	const [, toolName, paramString] = toolCallMatch;
	const args: Record<string, any> = {};

	if (paramString.trim()) {
		// Match parameters like param1="value1", param2=123
		const paramMatches = paramString.matchAll(
			/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g,
		);
		for (const match of paramMatches) {
			const [, key, quotedValue, singleQuotedValue, unquotedValue] = match;
			const value = quotedValue || singleQuotedValue || unquotedValue;

			// Try to parse as number if it's unquoted and looks like a number
			if (!quotedValue && !singleQuotedValue && /^\d+(\.\d+)?$/.test(value)) {
				args[key] = Number(value);
			} else {
				args[key] = value;
			}
		}
	}

	return { name: toolName, arguments: args };
}
