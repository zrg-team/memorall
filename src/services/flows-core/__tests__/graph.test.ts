import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BaseTool } from "@/services/flows-core/interfaces/engine/tool";
import type { AgentState } from "@/services/flows-core/graph/agent/state";
import {
	AgentGraph,
	mergeStreamedToolCall,
} from "@/services/flows-core/graph/agent/graph";
import {
	MISSING_TOOL_CALL_RESULT_CONTENT,
	normalizeChatMessages,
} from "@/services/flows-core/graph/graph.base";

const baseState = (
	outputMessages: AgentState["outputMessages"],
): AgentState => ({
	messages: [],
	outputMessages,
	tools: [],
	response: "",
	maxIterations: 10,
	currentIteration: 0,
});

const createGraph = (tools: BaseTool[]) =>
	new AgentGraph(
		{
			llm: {
				isReady: () => true,
				getCurrentModel: async () => ({ modelId: "test-model" }),
				getMaxModelTokens: async () => 4096,
				getMaxResponseTokens: async () => 1024,
				chatCompletions: () => {
					throw new Error("LLM should not be called by tool-node tests");
				},
			},
		},
		{ tools },
	);

describe("mergeStreamedToolCall", () => {
	it("assembles streamed function names and arguments by index", () => {
		const calls = new Map();

		mergeStreamedToolCall(calls, {
			index: 0,
			id: "call_1",
			type: "function",
			function: { name: "curr", arguments: '{"city":' },
		});
		mergeStreamedToolCall(calls, {
			index: 0,
			function: { name: "ent_time", arguments: '"Bangkok"}' },
		});

		expect(calls.get(0)).toEqual({
			id: "call_1",
			type: "function",
			function: {
				name: "current_time",
				arguments: '{"city":"Bangkok"}',
			},
		});
	});

	it("keeps multiple streamed tool-call indexes separate", () => {
		const calls = new Map();

		mergeStreamedToolCall(calls, {
			index: 0,
			id: "call_1",
			function: { name: "alpha", arguments: '{"a":' },
		});
		mergeStreamedToolCall(calls, {
			index: 1,
			id: "call_2",
			function: { name: "beta", arguments: '{"b":2}' },
		});
		mergeStreamedToolCall(calls, {
			index: 0,
			function: { arguments: "1}" },
		});

		expect(Array.from(calls.values())).toEqual([
			{
				id: "call_1",
				type: "function",
				function: { name: "alpha", arguments: '{"a":1}' },
			},
			{
				id: "call_2",
				type: "function",
				function: { name: "beta", arguments: '{"b":2}' },
			},
		]);
	});
});

describe("normalizeChatMessages tool cleanup", () => {
	it("removes an assistant tool-call message when no tool result exists", () => {
		const messages = normalizeChatMessages([
			{ role: "user", content: "Please show me" },
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: "call_missing",
						type: "function",
						function: { name: "hyperframes_show", arguments: "{}" },
					},
				],
			},
			{ role: "user", content: "Please show me again" },
		]);

		expect(messages).toEqual([
			{ role: "user", content: "Please show me" },
			{ role: "user", content: "Please show me again" },
		]);
	});

	it("removes tool messages without a matching assistant tool call", () => {
		const messages = normalizeChatMessages([
			{ role: "user", content: "hello" },
			{
				role: "tool",
				content: "orphan result",
				tool_call_id: "call_orphan",
			},
			{ role: "assistant", content: "done" },
		]);

		expect(messages).toEqual([
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "done" },
		]);
	});

	it("fills a missing result in a partially resolved multi-tool-call message", () => {
		const messages = normalizeChatMessages([
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: "call_ok",
						type: "function",
						function: { name: "one", arguments: "{}" },
					},
					{
						id: "call_missing",
						type: "function",
						function: { name: "two", arguments: "{}" },
					},
				],
			},
			{
				role: "tool",
				content: "ok",
				tool_call_id: "call_ok",
			},
		]);

		expect(messages).toEqual([
			expect.objectContaining({
				role: "assistant",
				tool_calls: expect.arrayContaining([
					expect.objectContaining({ id: "call_ok" }),
					expect.objectContaining({ id: "call_missing" }),
				]),
			}),
			{ role: "tool", content: "ok", tool_call_id: "call_ok" },
			{
				role: "tool",
				content: MISSING_TOOL_CALL_RESULT_CONTENT,
				tool_call_id: "call_missing",
			},
		]);
	});
});

describe("AgentGraph toolsNode", () => {
	it("returns a tool message when a requested tool is not registered", async () => {
		const graph = createGraph([]);

		const result = await graph.toolsNode(
			baseState([
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_missing",
							type: "function",
							function: { name: "missing_tool", arguments: "{}" },
						},
					],
				},
			]),
		);

		expect(result.outputMessages?.at(-1)).toEqual({
			role: "tool",
			content: "Error: Tool 'missing_tool' not found",
			tool_call_id: "call_missing",
		});
	});

	it("returns a tool message when tool execution fails", async () => {
		const failingTool: BaseTool = {
			name: "failing_tool",
			description: "Fails on purpose",
			schema: z.object({}),
			execute: async () => {
				throw new Error("boom");
			},
		};
		const graph = createGraph([failingTool]);

		const result = await graph.toolsNode(
			baseState([
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_fail",
							type: "function",
							function: { name: "failing_tool", arguments: "{}" },
						},
					],
				},
			]),
		);

		expect(result.outputMessages?.at(-1)).toEqual({
			role: "tool",
			content: "Error: boom",
			tool_call_id: "call_fail",
		});
	});
});
