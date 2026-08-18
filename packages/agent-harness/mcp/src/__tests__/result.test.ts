import { describe, expect, it } from "vitest";
import { McpToolError, normalizeMcpToolResult } from "../result.js";

describe("normalizeMcpToolResult", () => {
  it("returns plain text when the result is only text", () => {
    expect(
      normalizeMcpToolResult("srv", "tool", {
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
      }),
    ).toBe("line one\nline two");
  });

  it("keeps structured content by carrying the result as JSON", () => {
    const parsed = JSON.parse(
      normalizeMcpToolResult("srv", "tool", {
        content: [{ type: "text", text: "done" }],
        structuredContent: { id: 7 },
        meta: { traceId: "abc" },
      }),
    );

    expect(parsed).toEqual({
      text: "done",
      structuredContent: { id: 7 },
      meta: { traceId: "abc" },
    });
  });

  it("keeps non-text blocks that plain text would discard", () => {
    const parsed = JSON.parse(
      normalizeMcpToolResult("srv", "tool", {
        content: [
          { type: "text", text: "see image" },
          { type: "image", data: "…", mimeType: "image/png" },
        ],
      }),
    );

    expect(parsed.text).toBe("see image");
    expect(parsed.content).toEqual([
      { type: "image", data: "…", mimeType: "image/png" },
    ]);
  });

  it("raises the server's own message when the call reports an error", () => {
    expect(() =>
      normalizeMcpToolResult("srv", "tool", {
        content: [{ type: "text", text: "calendar not authorized" }],
        isError: true,
      }),
    ).toThrow(new McpToolError("calendar not authorized"));
  });

  it("names the server and tool when the result has no content at all", () => {
    expect(() => normalizeMcpToolResult("srv", "tool", {} as never)).toThrow(
      /MCP tool "tool" on server "srv"/,
    );
  });
});
