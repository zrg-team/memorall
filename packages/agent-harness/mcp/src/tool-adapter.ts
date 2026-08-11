import {
  assertJsonValue,
  jsonToolSchema,
  type BaseTool,
  type JsonValue,
  type ToolExecutionResult,
} from "@memorall/agent-harness-core";
import { MCP_TOOL_SERVICE, type McpToolDescriptor } from "./contracts.js";

const isTextContent = (part: JsonValue): part is { readonly [key: string]: JsonValue } & { type: "text"; text: string } => {
  if (typeof part !== "object" || part === null || Array.isArray(part)) return false;
  const value = part as Readonly<Record<string, JsonValue>>;
  return value.type === "text" && typeof value.text === "string";
};

const textContent = (content: readonly JsonValue[]): string => content
  .filter(isTextContent)
  .map(({ text }) => text)
  .join("\n");

export const adaptMcpTool = (descriptor: McpToolDescriptor): BaseTool<Record<string, unknown>> => ({
  name: descriptor.exposedName,
  title: descriptor.title,
  description: descriptor.description,
  schema: jsonToolSchema(descriptor.inputSchema, (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("MCP tool input must be an object");
    return input as Record<string, unknown>;
  }),
  outputSchema: descriptor.outputSchema,
  icons: descriptor.icons,
  annotations: descriptor.annotations,
  metadata: {
    category: "mcp",
    serverId: descriptor.serverId,
    originalToolName: descriptor.name,
    ...(descriptor.metadata ?? {}),
  },
  requiredServices: [MCP_TOOL_SERVICE],
  async execute(input, context): Promise<ToolExecutionResult> {
    const result = await context.services.get(MCP_TOOL_SERVICE).call(
      descriptor.serverId,
      descriptor.name,
      input,
      { signal: context.signal, deadlineMs: context.deadlineMs },
    );
    const text = textContent(result.content);
    const content = text || JSON.stringify(result.content);
    if (result.structuredContent !== undefined) assertJsonValue(result.structuredContent, "MCP structured result");
    return {
      content,
      structuredContent: result.structuredContent,
      isError: result.isError,
      meta: {
        operationId: context.operationId,
        ...(result.meta === undefined ? {} : { mcp: result.meta }),
      },
    };
  },
});
