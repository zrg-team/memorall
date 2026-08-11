import { describe, expect, it } from "vitest";
import {
  RunContext,
  ServiceResolver,
  createHarness,
  executeTool,
} from "@memorall/agent-harness-core";
import { createTestPlatform } from "@memorall/agent-harness-core/testing";
import {
  MCP_TOOL_SERVICE,
  McpClientManager,
  adaptMcpTool,
  createMcpHttpTransport,
  mcpPlugin,
  type McpToolDescriptor,
  type McpToolService,
} from "../index.js";

const descriptor: McpToolDescriptor = {
  serverId: "remote",
  name: "lookup",
  exposedName: "remote__lookup",
  title: "Lookup",
  description: "Look up a record",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  outputSchema: { type: "object", properties: { found: { type: "boolean" } } },
  icons: [{ src: "https://example.test/icon.png", mimeType: "image/png" }],
  annotations: { readOnlyHint: true, idempotentHint: true },
};

describe("MCP package", () => {
  it("adapts schemas, metadata, content, structured output, and errors", async () => {
    const calls: unknown[] = [];
    const service: McpToolService = {
      call: async (...args) => {
        calls.push(args);
        return {
          content: [
            { type: "text", text: "found" },
            { type: "resource_link", uri: "https://example.test", name: "record" },
          ] as const,
          structuredContent: { found: true },
          meta: { requestId: "mcp-1" },
        };
      },
    };
    const platform = createTestPlatform();
    const result = await executeTool(adaptMcpTool(descriptor), { id: "42" }, {
      runId: "run", operationId: "call", signal: new AbortController().signal,
      scope: {}, state: {}, runtime: new RunContext(), platform,
      services: new ServiceResolver({ [MCP_TOOL_SERVICE.id]: service }),
    });
    expect(result).toMatchObject({ content: "found", structuredContent: { found: true }, meta: { operationId: "call", mcp: { requestId: "mcp-1" } } });
    expect(calls[0]).toEqual(expect.arrayContaining(["remote", "lookup", { id: "42" }]));

    const failing: McpToolService = { call: async () => ({ content: [{ type: "text", text: "denied" }], isError: true }) };
    const error = await executeTool(adaptMcpTool(descriptor), { id: "x" }, {
      runId: "run", operationId: "error", signal: new AbortController().signal,
      scope: {}, state: {}, runtime: new RunContext(), platform,
      services: new ServiceResolver({ [MCP_TOOL_SERVICE.id]: failing }),
    });
    expect(error).toMatchObject({ content: "denied", isError: true });
  });

  it("registers discovered descriptors explicitly without import side effects", () => {
    expect(createHarness({ platform: createTestPlatform() }).inspect().tools).toEqual([]);
    const harness = createHarness({ platform: createTestPlatform(), plugins: [mcpPlugin([descriptor])] });
    expect(harness.inspect().tools).toEqual(["remote__lookup"]);
  });

  it("validates server IDs and constructs HTTP and SSE transports lazily", () => {
    expect(() => new McpClientManager([
      { id: "same", url: "https://example.test/mcp" },
      { id: "same", url: "https://example.test/other" },
    ])).toThrow(/Duplicate MCP server/);
    expect(() => new McpClientManager([{ id: "bad", url: "not a URL" }])).toThrow();
    expect(createMcpHttpTransport({ id: "http", url: "https://example.test/mcp" }).constructor.name).toContain("StreamableHTTP");
    expect(createMcpHttpTransport({ id: "sse", url: "https://example.test/sse", transport: "sse" }).constructor.name).toContain("SSE");
  });
});
