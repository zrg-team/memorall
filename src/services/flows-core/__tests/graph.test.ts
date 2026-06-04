import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BaseTool } from "flow-core/interfaces/engine/tool";
import type { AgentState } from "flow-core/graph/agent/state";
import { AgentGraph, mergeStreamedToolCall } from "flow-core/graph/agent/graph";

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
