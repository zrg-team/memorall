import { describe, expect, it } from "vitest";
import type {
	ComplexContentPartTool,
	MessageParts,
	ToolExecutionRecord,
} from "@/types/chat";
import { buildAssistantContentParts } from "../message-parts-adapter";

const toolParts = (
	parts: ReturnType<typeof buildAssistantContentParts>,
): ComplexContentPartTool[] =>
	parts.filter((part): part is ComplexContentPartTool => part.type === "tool");

const searchResult = {
	actionType: "web_search",
	query: "memorall",
	results: [{ engine: "duckduckgo", searchUrl: "https://x", results: [] }],
};

const parts: MessageParts = [
	{
		role: "assistant",
		content: "",
		tool_calls: [
			{
				id: "call_1",
				type: "function",
				function: { name: "web_search", arguments: '{"query":"memorall"}' },
			},
		],
	},
	{
		role: "tool",
		tool_call_id: "call_1",
		content: JSON.stringify(searchResult),
	},
	{ role: "assistant", content: "Here is what I found." },
];

const record: ToolExecutionRecord = {
	id: "call_1",
	name: "web_search",
	status: "completed",
	startedAt: "2026-08-17T00:00:00.000Z",
	endedAt: "2026-08-17T00:00:02.000Z",
	durationMs: 2_000,
	inputPreview: '{"query":"memorall"}',
	// What the record keeps is clipped, so on its own it cannot be parsed back
	// into a payload — this is the shape that broke the rich renderers.
	outputPreview: `${JSON.stringify(searchResult).slice(0, 20)}\n… [truncated]`,
	truncated: true,
};

describe("buildAssistantContentParts", () => {
	it("keeps the structured payload when an execution record exists", () => {
		const [tool] = toolParts(
			buildAssistantContentParts({ parts, toolExecutions: [record] }),
		);

		expect(tool.metadata?.actionType).toBe("web_search");
		expect(tool.metadata?.query).toBe("memorall");
		expect(tool.description).toContain('"actionType"');
		expect(tool.description).not.toContain("truncated");
	});

	it("lets the record own timing and status, not the payload", () => {
		const [tool] = toolParts(
			buildAssistantContentParts({
				parts: [
					parts[0],
					{
						role: "tool",
						tool_call_id: "call_1",
						content: JSON.stringify({ ...searchResult, durationMs: 999_999 }),
					},
				],
				toolExecutions: [record],
			}),
		);

		expect(tool.metadata?.durationMs).toBe(2_000);
		expect(tool.metadata?.startedAt).toBe("2026-08-17T00:00:00.000Z");
		expect(tool.state).toBe("complete");
	});

	it("pairs the record with the real tool call so raw input is the call itself", () => {
		const [tool] = toolParts(
			buildAssistantContentParts({ parts, toolExecutions: [record] }),
		);

		expect(tool.metadata?.tool_call).toEqual({
			id: "call_1",
			type: "function",
			function: { name: "web_search", arguments: '{"query":"memorall"}' },
		});
	});

	it("surfaces MCP identity so a run is labelled by server and tool", () => {
		const [tool] = toolParts(
			buildAssistantContentParts({
				parts: [
					{
						role: "tool",
						tool_call_id: "call_2",
						content: '{"data":{"ok":true}}',
					},
				],
				toolExecutions: [
					{
						...record,
						id: "call_2",
						name: "composio__COMPOSIO_MULTI_EXECUTE_TOOL",
						toolMetadata: {
							source: "mcp",
							mcp: {
								serverName: "composio",
								originalToolName: "COMPOSIO_MULTI_EXECUTE_TOOL",
							},
						},
					},
				],
			}),
		);

		expect(tool.metadata?.tool_metadata).toMatchObject({
			mcp: { serverName: "composio" },
		});
	});

	it("falls back to the record preview while the result is still streaming", () => {
		const running: ToolExecutionRecord = {
			id: "call_9",
			name: "web_search",
			status: "running",
			startedAt: "2026-08-17T00:00:00.000Z",
		};
		const [tool] = toolParts(
			buildAssistantContentParts({ parts: [], toolExecutions: [running] }),
		);

		expect(tool.state).toBe("running");
		expect(tool.description).toBe("");
	});

	it("still renders a tool message that has no execution record", () => {
		const tools = toolParts(
			buildAssistantContentParts({ parts, toolExecutions: [] }),
		);

		expect(tools).toHaveLength(1);
		expect(tools[0].metadata?.actionType).toBe("web_search");
	});

	it("does not duplicate a tool that has both a record and a message", () => {
		const tools = toolParts(
			buildAssistantContentParts({ parts, toolExecutions: [record] }),
		);

		expect(tools).toHaveLength(1);
	});

	it("keeps assistant text alongside the tool card", () => {
		const built = buildAssistantContentParts({
			parts,
			toolExecutions: [record],
		});

		expect(built).toContainEqual({
			type: "text",
			text: "Here is what I found.",
		});
	});
});
