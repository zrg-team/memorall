import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../graph/agent/graph.js";
import "../graph/foundation/graph.js";
import "../steps/common/add-system.js";
import "../steps/common/agent-completion.js";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
	ChatCompletionUsage,
} from "../interfaces/engine/messages.js";
import type { BaseTool } from "../interfaces/engine/tool.js";
import type { AllServices } from "../interfaces/services/services.js";
import type { IFlowLLMService } from "../interfaces/services/llm.js";
import type { ChildAgentRun } from "../interfaces/tools/multi-agent.js";
import { MultiAgentManager } from "../steps/features/multi-agent-feature/conversation-manager.js";
import { createSendMessageToAgentTool } from "../tools/send-message-to-agent.js";

/**
 * A child agent is a conversation, not a series of one-off calls: the second
 * message it gets is read after everything it did for the first — its tool
 * calls and their results included — exactly as it read it then. Anything
 * less and the child forgets its own work, and its request stops matching the
 * prefix the provider has cached at the first tool call.
 */

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
): ChatCompletionChunk => ({
	id: "chunk",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [{ index: 0, delta, finish_reason: null }],
});

const usageChunk = (usage: ChatCompletionUsage): ChatCompletionChunk => ({
	id: "usage",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [],
	usage,
});

const callLookup = chunk({
	role: "assistant",
	content: null,
	tool_calls: [
		{
			index: 0,
			id: "call_1",
			type: "function",
			function: { name: "lookup", arguments: '{"q":"release"}' },
		},
	],
});

const usage = (prompt: number, cached: number): ChatCompletionUsage => ({
	prompt_tokens: prompt,
	completion_tokens: 10,
	total_tokens: prompt + 10,
	cached_tokens: cached,
	cost: 0.001,
});

/** Each request is answered with the next script, recording what it read. */
const scriptedLlm = (
	requests: ChatCompletionRequest[],
	scripts: ChatCompletionChunk[][],
): IFlowLLMService => ({
	isReady: () => true,
	getCurrentModel: async () => ({ modelId: "test-model" }),
	getMaxModelTokens: async () => 128_000,
	getMaxResponseTokens: async () => 1024,
	chatCompletions: ((request: ChatCompletionRequest) => {
		const script = scripts[requests.length] ?? [];
		requests.push(structuredClone(request));
		return (async function* () {
			yield* script;
		})();
	}) as IFlowLLMService["chatCompletions"],
});

const lookupTool: BaseTool = {
	name: "lookup",
	description: "Look something up",
	schema: z.object({ q: z.string() }),
	execute: async () => "v2.1 shipped on Monday",
};

const createManager = (scripts: ChatCompletionChunk[][]) => {
	const requests: ChatCompletionRequest[] = [];
	const services = {
		llm: scriptedLlm(requests, scripts),
		flowCatalog: {
			listFlows: async () => [{ id: "researcher", name: "Researcher" }],
			getFlowConfig: async () => ({
				graphType: "foundation",
				steps: [
					{
						id: "system_1",
						name: "add-system",
						enabled: true,
						config: { content: "You research releases." },
					},
					{
						id: "completion_1",
						name: "agent-completion",
						enabled: true,
						config: { tools: [lookupTool] },
					},
				],
			}),
		},
	} as unknown as AllServices;
	const manager = new MultiAgentManager({
		childAgents: [{ id: "researcher", name: "Researcher" }],
		services,
	});
	return { manager, requests };
};

const twoMessageScripts = [
	[callLookup, usageChunk(usage(100, 0))],
	[
		chunk({ role: "assistant", content: "It shipped Monday." }),
		usageChunk(usage(140, 100)),
	],
	[
		chunk({ role: "assistant", content: "No regressions." }),
		usageChunk(usage(170, 150)),
	],
];

describe("messages to a child agent", () => {
	it("replay the child's whole conversation, tool calls included", async () => {
		const { manager, requests } = createManager(twoMessageScripts);

		await manager.sendMessage("researcher", "When did v2.1 ship?");
		await manager.sendMessage("researcher", "Any regressions?");

		expect(requests).toHaveLength(3);
		const [, lastOfFirst, second] = requests.map((request) => request.messages);
		// The second message's request is the first message's last request,
		// byte for byte, then the answer the child gave and the new message.
		expect(second?.slice(0, lastOfFirst?.length)).toEqual(lastOfFirst);
		expect(second?.slice(lastOfFirst?.length)).toEqual([
			{ role: "assistant", content: "It shipped Monday." },
			{ role: "user", content: "Any regressions?" },
		]);
		expect(lastOfFirst?.map((message) => message.role)).toEqual([
			"system",
			"user",
			"assistant",
			"tool",
		]);
		// One system prompt, written fresh, never merged with a replayed copy.
		expect(second?.filter((message) => message.role === "system")).toHaveLength(
			1,
		);
	});

	it("report what the child did, what it cost and who answered", async () => {
		const { manager } = createManager(twoMessageScripts);
		const progress: ChildAgentRun[] = [];
		const forwarded: unknown[] = [];

		const first = await manager.sendMessage(
			"researcher",
			"When did v2.1 ship?",
			{
				writer: (event) => forwarded.push(event),
				onProgress: (run) => progress.push(run),
			},
		);

		expect(first.response).toBe("It shipped Monday.");
		expect(first.run).toMatchObject({
			agent: { id: "researcher", name: "Researcher" },
			turn: 1,
			status: "completed",
			requests: 2,
			usage: {
				prompt_tokens: 240,
				completion_tokens: 20,
				cached_tokens: 100,
				cost: 0.002,
			},
		});
		expect(first.run.steps).toEqual([
			{
				type: "tool",
				id: "call_1",
				name: "lookup",
				input: expect.stringContaining("release"),
				output: "v2.1 shipped on Monday",
				status: "completed",
				startedAt: expect.any(String),
				durationMs: expect.any(Number),
			},
			{ type: "text", content: "It shipped Monday." },
		]);
		// The card names the agent before the child has done anything.
		expect(progress[0]).toMatchObject({
			agent: { name: "Researcher" },
			status: "running",
			steps: [],
		});
		// The parent run is told what the child's requests cost, and nothing
		// it could mistake for its own reply.
		expect(forwarded).toEqual([
			{
				type: "llm",
				chunk: expect.objectContaining({
					choices: [],
					usage: expect.objectContaining({ prompt_tokens: 100 }),
				}),
			},
			{
				type: "llm",
				chunk: expect.objectContaining({
					choices: [],
					usage: expect.objectContaining({ prompt_tokens: 140 }),
				}),
			},
		]);

		const second = await manager.sendMessage("researcher", "Any regressions?");
		expect(first.run.history).toEqual([]);
		expect(second.run.turn).toBe(2);
		// The chat can show what the child still has in front of it.
		expect(second.run.history).toEqual([
			{
				turn: 1,
				message: "When did v2.1 ship?",
				reply: "It shipped Monday.",
				tools: 1,
			},
		]);
		expect(second.run.steps).toEqual([
			{ type: "text", content: "No regressions." },
		]);
	});

	it("give the parent the reply and the chat the run", async () => {
		const { manager } = createManager(twoMessageScripts);
		const events: Array<Record<string, unknown>> = [];
		const tool = createSendMessageToAgentTool(undefined, {
			multiAgentManager: manager,
		});

		const result = await tool.execute(
			{ agentId: "researcher", message: "When did v2.1 ship?" },
			{
				state: {},
				toolCallId: "parent_call",
				writer: (event) => events.push(event as Record<string, unknown>),
			},
		);

		expect(result).toMatchObject({
			content: "It shipped Monday.",
			meta: { childRun: { agent: { name: "Researcher" }, turn: 1 } },
		});
		const progress = events.filter((event) => event.type === "tool-progress");
		expect(progress.length).toBeGreaterThan(0);
		expect(progress[0]).toMatchObject({
			node: "tool_executor",
			metadata: {
				tool: "send_message_to_agent",
				tool_call_id: "parent_call",
				meta: { childRun: { agent: { name: "Researcher" } } },
			},
		});
	});
});
