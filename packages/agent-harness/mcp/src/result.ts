/**
 * MCP call results, reduced to something a model can read.
 *
 * A result is a list of content blocks plus optional structured content and
 * metadata. When everything is text, the model wants the text and nothing else.
 * When it is not — images, resources, structured payloads — the extra parts have
 * to survive, so the result is carried as JSON that a caller can parse back.
 */

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

export interface McpRawCallResult {
  content?: readonly Record<string, unknown>[];
  isError?: boolean;
  structuredContent?: unknown;
  meta?: unknown;
}

const textOf = (content: Record<string, unknown>): string | null =>
  content.type === "text" && typeof content.text === "string"
    ? content.text
    : null;

export const normalizeMcpToolResult = (
  serverId: string,
  toolName: string,
  result: McpRawCallResult,
): string => {
  if (!result || !Array.isArray(result.content)) {
    throw new McpToolError(
      `MCP tool "${toolName}" on server "${serverId}" returned an invalid result.`,
    );
  }

  const textParts = result.content
    .map(textOf)
    .filter((value): value is string => Boolean(value));

  if (result.isError) {
    throw new McpToolError(
      textParts.join("\n") ||
        `MCP tool "${toolName}" on server "${serverId}" returned an error.`,
    );
  }

  const nonTextContent = result.content.filter(
    (content) => textOf(content) === null,
  );

  // Nothing but text: hand back the text, not a JSON wrapper around it.
  if (
    nonTextContent.length === 0 &&
    result.structuredContent === undefined &&
    result.meta === undefined
  ) {
    return textParts.join("\n");
  }

  return JSON.stringify({
    ...(textParts.length > 0 ? { text: textParts.join("\n") } : {}),
    ...(nonTextContent.length > 0 ? { content: nonTextContent } : {}),
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
    ...(result.meta !== undefined ? { meta: result.meta } : {}),
  });
};
