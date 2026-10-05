import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonToolSchema, type BaseTool } from "../interfaces/engine/tool.js";
import type { AgentState } from "../graph/agent/state.js";
import {
	AgentGraph,
	MAX_CONSECUTIVE_TOOL_FAILURES,
	mergeStreamedToolCall,
} from "../graph/agent/graph.js";
import { recursionLimitForIterations } from "../limits.js";
import {
	createFlowRunInbox,
	FLOW_RUN_INBOX_REMINDER,
	FLOW_RUN_INBOX_RUNTIME_KEY,
	formatFlowRunInboxMessage,
	unwrapFlowRunInboxMessage,
} from "../context/run-inbox.js";
import {
	createFlowRuntimeVars,
	FLOW_RUNTIME_VARS_CONFIG_KEY,
} from "../context/runtime-context.js";
import {
	MISSING_TOOL_CALL_RESULT_CONTENT,
	normalizeChatMessages,
} from "../graph/graph.base.js";

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

	it("stops after repeated failures from the same tool", async () => {
		const failingTool: BaseTool = {
			name: "failing_tool",
			description: "Fails on purpose",
			schema: z.object({}),
			execute: async () => {
				throw new Error("missing owner and repo");
			},
		};
		const graph = createGraph([failingTool]);
		let state = baseState([]);

		for (let attempt = 1; attempt <= MAX_CONSECUTIVE_TOOL_FAILURES; attempt++) {
			state = {
				...state,
				outputMessages: [
					...state.outputMessages,
					{
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: `call_fail_${attempt}`,
								type: "function",
								function: { name: "failing_tool", arguments: "{}" },
							},
						],
					},
				],
			};
			const result = await graph.toolsNode(state);
			state = { ...state, ...result } as AgentState;
		}

		expect(state.toolFailureStreak).toMatchObject({
			toolName: "failing_tool",
			count: MAX_CONSECUTIVE_TOOL_FAILURES,
		});

		const result = await graph.agentNode(state);
		expect(result.response).toContain(
			`stopped retrying failing_tool after ${MAX_CONSECUTIVE_TOOL_FAILURES} consecutive errors`,
		);
		expect(result.toolFailureStreak).toBeNull();
	});
});

describe("agent iteration limit reaches LangGraph", () => {
	it("budgets two steps per turn plus the initial node", () => {
		// LangGraph counts every node it runs; one turn that calls a tool is two
		// of them. Its own default is 25, which has nothing to do with the limit
		// the user set.
		expect(recursionLimitForIterations(50)).toBe(104);
		expect(recursionLimitForIterations(25)).toBe(54);
		// Out-of-range values go through the same normalisation as the setting.
		expect(recursionLimitForIterations(Number.NaN)).toBe(104);
	});

	it("runs every configured iteration instead of stopping at LangGraph's 25", async () => {
		// The regression: a run configured for 50 turns died on "Recursion limit
		// of 25 reached" after about twelve tool calls. Fifty turns is roughly a
		// hundred super-steps, so completing them is only possible if the graph
		// was given a budget derived from its own limit.
		const maxIterations = 20;
		let turns = 0;

		const tool: BaseTool = {
			name: "ping",
			description: "ping",
			schema: jsonToolSchema({ type: "object", properties: {} }),
			execute: async () => "pong",
		};

		const graph = new AgentGraph(
			{
				llm: {
					isReady: () => true,
					getCurrentModel: async () => ({ modelId: "test" }),
					getMaxModelTokens: async () => 128000,
					getMaxResponseTokens: async () => 4096,
					// Never finishes on its own: only a limit can end this run.
					chatCompletions: (() =>
						(async function* () {
							turns += 1;
							yield {
								id: "chunk",
								object: "chat.completion.chunk",
								created: 0,
								model: "test",
								choices: [
									{
										index: 0,
										delta: {
											role: "assistant",
											content: null,
											tool_calls: [
												{
													index: 0,
													id: `call_${turns}`,
													type: "function",
													function: { name: "ping", arguments: "{}" },
												},
											],
										},
										finish_reason: null,
									},
								],
							};
						})()) as never,
				},
			},
			{ tools: [tool], maxIterations },
		);

		const stream = await graph.stream(
			{ messages: [{ role: "user", content: "go" }], maxIterations },
			{ streamMode: ["values"] },
		);
		for await (const _ of stream as AsyncIterable<unknown>) {
			// drain
		}

		expect(turns).toBe(maxIterations);
	});
});

describe("messages sent while the agent works", () => {
	const chunk = (delta: Record<string, unknown>) => ({
		id: "chunk",
		object: "chat.completion.chunk",
		created: 0,
		model: "test",
		choices: [{ index: 0, delta, finish_reason: null }],
	});

	it("reads them before its next request, after the tool results, and keeps them", async () => {
		const inbox = createFlowRunInbox();
		const requests: Array<Array<{ role: string; content?: unknown }>> = [];
		const tool: BaseTool = {
			name: "ping",
			description: "ping",
			schema: jsonToolSchema({ type: "object", properties: {} }),
			// The user writes while the tool runs.
			execute: async () => {
				inbox.push({ id: "m-1", content: "Also check the logs" });
				return "pong";
			},
		};
		const graph = new AgentGraph(
			{
				llm: {
					isReady: () => true,
					getCurrentModel: async () => ({ modelId: "test" }),
					getMaxModelTokens: async () => 128000,
					getMaxResponseTokens: async () => 4096,
					chatCompletions: ((body: { messages: never[] }) =>
						(async function* () {
							requests.push(body.messages);
							yield requests.length === 1
								? chunk({
										role: "assistant",
										content: null,
										tool_calls: [
											{
												index: 0,
												id: "call_1",
												type: "function",
												function: { name: "ping", arguments: "{}" },
											},
										],
									})
								: chunk({ role: "assistant", content: "Done, logs too." });
						})()) as never,
				},
			},
			{ tools: [tool] },
		);

		const events: unknown[] = [];
		let finalMessages: Array<{ role: string; content?: unknown }> = [];
		const stream = await graph.stream(
			{ messages: [{ role: "user", content: "go" }] },
			{
				streamMode: ["custom", "values"],
				configurable: {
					[FLOW_RUNTIME_VARS_CONFIG_KEY]: createFlowRuntimeVars({
						[FLOW_RUN_INBOX_RUNTIME_KEY]: inbox,
					}),
				},
			},
		);
		for await (const [mode, payload] of stream as AsyncIterable<
			[string, Record<string, unknown>]
		>) {
			if (mode === "custom") events.push(payload);
			if (mode === "values") finalMessages = payload.messages as never;
		}

		// The second request has it right after the tool's result.
		const second = requests[1] ?? [];
		const toolIndex = second.findIndex((message) => message.role === "tool");
		expect(second[toolIndex + 1]).toEqual({
			role: "user",
			content: "<by-the-way>\nAlso check the logs\n</by-the-way>",
		});
		// The caller hears which message was read.
		expect(events).toContainEqual({
			type: "user-message",
			id: "m-1",
			content: "Also check the logs",
		});
		// The reply keeps it where it was read.
		expect(finalMessages.map((message) => message.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
			"user",
			"assistant",
		]);
		expect(inbox.take()).toEqual([]);
	});

	it("reads them as a by-the-way to the task it is on, for the rest of the run", async () => {
		const inbox = createFlowRunInbox();
		const requests: Array<Array<{ role: string; content?: unknown }>> = [];
		let pings = 0;
		const tool: BaseTool = {
			name: "ping",
			description: "ping",
			schema: jsonToolSchema({ type: "object", properties: {} }),
			execute: async () => {
				pings += 1;
				if (pings === 1)
					inbox.push({ id: "m-1", content: "Also check the logs" });
				return "pong";
			},
		};
		const toolCall = (id: string) =>
			chunk({
				role: "assistant",
				content: null,
				tool_calls: [
					{
						index: 0,
						id,
						type: "function",
						function: { name: "ping", arguments: "{}" },
					},
				],
			});
		const graph = new AgentGraph(
			{
				llm: {
					isReady: () => true,
					getCurrentModel: async () => ({ modelId: "test" }),
					getMaxModelTokens: async () => 128000,
					getMaxResponseTokens: async () => 4096,
					chatCompletions: ((body: { messages: never[] }) =>
						(async function* () {
							requests.push(body.messages);
							yield requests.length < 3
								? toolCall(`call_${requests.length}`)
								: chunk({ role: "assistant", content: "Both done." });
						})()) as never,
				},
			},
			{ tools: [tool] },
		);

		const stream = await graph.stream(
			{ messages: [{ role: "user", content: "go" }] },
			{
				streamMode: ["custom", "values"],
				configurable: {
					[FLOW_RUNTIME_VARS_CONFIG_KEY]: createFlowRuntimeVars({
						[FLOW_RUN_INBOX_RUNTIME_KEY]: inbox,
					}),
				},
			},
		);
		for await (const _ of stream as AsyncIterable<unknown>) {
			// drain
		}

		const reminder = `<system-reminder>\n${FLOW_RUN_INBOX_REMINDER}\n</system-reminder>`;
		const tail = (request: Array<{ role: string; content?: unknown }> = []) =>
			request[request.length - 1];
		// Nothing was sent yet: the request is untouched.
		expect(requests[0]?.some((message) => message.content === reminder)).toBe(
			false,
		);
		// From the request that reads it on, the reminder rides past the end once.
		for (const request of requests.slice(1)) {
			expect(tail(request)).toEqual({ role: "user", content: reminder });
			expect(
				request.filter((message) => message.content === reminder),
			).toHaveLength(1);
		}
		// The message keeps its tag on every request after it was read.
		expect(requests[2]).toContainEqual({
			role: "user",
			content: formatFlowRunInboxMessage("Also check the logs"),
		});
	});

	it("tags a message as the model reads it and gives the user's words back", () => {
		const tagged = formatFlowRunInboxMessage("Also\ncheck the logs");
		expect(tagged).toBe("<by-the-way>\nAlso\ncheck the logs\n</by-the-way>");
		expect(unwrapFlowRunInboxMessage(tagged)).toBe("Also\ncheck the logs");
		// Replies stored before the tag read back as they were.
		expect(unwrapFlowRunInboxMessage("Also check the logs")).toBe(
			"Also check the logs",
		);
	});

	it("refuses messages once the run is over and hands back the unread", () => {
		const inbox = createFlowRunInbox();
		expect(inbox.push({ id: "a", content: "first" })).toBe(true);
		expect(inbox.push({ id: "b", content: "   " })).toBe(false);
		expect(inbox.close()).toEqual([{ id: "a", content: "first" }]);
		expect(inbox.closed).toBe(true);
		expect(inbox.push({ id: "c", content: "late" })).toBe(false);
	});
});
