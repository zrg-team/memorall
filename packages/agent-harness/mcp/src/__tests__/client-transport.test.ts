import { describe, expect, it } from "vitest";
import { McpClientManager } from "../client.js";

/**
 * A tool call is worth nothing if its arguments do not survive the trip, and a
 * schema is worth nothing if the model cannot tell from it what to put in them.
 * Both are checked here against the real client, over a transport that answers
 * like a server rather than a stub of one, so a regression in either shows up as
 * "the server received `{}`" — the exact symptom a broken client produces.
 */

const TOOLS = [
  {
    name: "MULTI_EXECUTE_TOOL",
    description: "Execute one or more tools",
    inputSchema: {
      type: "object",
      properties: {
        tools: { type: "array", items: { $ref: "#/$defs/ToolExecuteRequest" } },
        thought: {
          anyOf: [{ type: "string" }, { type: "null" }],
          default: null,
        },
      },
      required: ["tools"],
      $defs: {
        ToolExecuteRequest: {
          type: "object",
          properties: {
            tool_slug: { type: "string" },
            arguments: { type: "object", additionalProperties: true },
          },
          required: ["tool_slug", "arguments"],
        },
      },
    },
  },
];

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "mcp-session-id": "test-session",
    },
  });

const createServer = () => {
  const calls: Array<Record<string, unknown>> = [];

  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    if ((init?.method ?? "GET") !== "POST") {
      return new Response(null, { status: 405 });
    }

    const message = JSON.parse(String(init?.body)) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
    };

    if (message.method === "initialize") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: (message.params as { protocolVersion: string })
            .protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "test", version: "1.0.0" },
        },
      });
    }
    if (message.method?.startsWith("notifications/")) {
      return new Response(null, { status: 202 });
    }
    if (message.method === "tools/list") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: TOOLS },
      });
    }
    if (message.method === "tools/call") {
      calls.push(message.params ?? {});
      return jsonResponse({
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "ok" }] },
      });
    }
    return jsonResponse({ jsonrpc: "2.0", id: message.id, result: {} });
  };

  return { calls, fetchImpl };
};

describe("McpClientManager over a live transport", () => {
  it("publishes a schema with no dangling reference and delivers nested arguments", async () => {
    const { calls, fetchImpl } = createServer();
    const manager = new McpClientManager(
      [{ id: "router", url: "https://example.test/mcp" }],
      { name: "test", prefixToolNames: true, fetch: fetchImpl },
    );

    try {
      const [descriptor] = await manager.discover();

      // The model has to be able to see that each entry carries an `arguments`
      // object; a surviving `$ref` (or a union stripped of its type) leaves it
      // nothing to fill in.
      const properties = descriptor.inputSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      expect(properties.tools.items).toMatchObject({
        type: "object",
        properties: {
          tool_slug: { type: "string" },
          arguments: {
            type: "object",
            additionalProperties: true,
            // Free-form on the wire, but the model is told what belongs in it.
            description: expect.stringContaining("tool_slug"),
          },
        },
        required: ["tool_slug", "arguments"],
      });
      expect(properties.thought).toEqual({ type: "string", default: null });
      expect(JSON.stringify(descriptor.inputSchema)).not.toContain("$ref");

      await manager.call("router", "MULTI_EXECUTE_TOOL", {
        tools: [
          {
            tool_slug: "GITHUB_GET_A_REPOSITORY",
            arguments: { owner: "zrg-team", repo: "memorall" },
          },
        ],
      });

      expect(calls).toEqual([
        {
          name: "MULTI_EXECUTE_TOOL",
          arguments: {
            tools: [
              {
                tool_slug: "GITHUB_GET_A_REPOSITORY",
                arguments: { owner: "zrg-team", repo: "memorall" },
              },
            ],
          },
        },
      ]);
    } finally {
      await manager.close();
    }
  });
});
