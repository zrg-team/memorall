import { describe, expect, it } from "vitest";
import { z } from "zod";
import "../graph/agent/graph.js";
import "../graph/foundation/graph.js";
import "../steps/common/agent-completion.js";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
} from "../interfaces/engine/messages.js";
import type { BaseTool } from "../interfaces/engine/tool.js";
import type { IFlowLLMService } from "../interfaces/services/llm.js";
import { graphRegistry } from "../registries/graph-registry.js";

/**
 * Context a caller hands a run for this request only — the page the user is
 * on, what they pointed at — has to arrive past the end of the conversation.
 * Anywhere earlier and it rewrites the cached prefix of everything behind it.
 */

const answer: ChatCompletionChunk = {
	id: "chunk-1",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [
		{
			index: 0,
			delta: { role: "assistant", content: "ok" },
			finish_reason: "stop",
		},
	],
};

const recordingLlm = (requests: ChatCompletionRequest[]): IFlowLLMService => ({
	isReady: () => true,
	getCurrentModel: async () => ({ modelId: "test-model" }),
	getMaxModelTokens: async () => 128_000,
	getMaxResponseTokens: async () => 1024,
	chatCompletions: ((request: ChatCompletionRequest) => {
		requests.push(request);
		return (async function* () {
			yield answer;
		})();
	}) as IFlowLLMService["chatCompletions"],
});

const noopTool: BaseTool = {
	name: "noop",
	description: "noop test tool",
	schema: z.object({}),
	execute: async () => "done",
};

const runWithReminders = async (graphType: "agent" | "foundation") => {
	const requests: ChatCompletionRequest[] = [];
	const { graph, getInitialState } = graphRegistry.createChatGraph(
		graphType,
		{ llm: recordingLlm(requests) } as never,
		{
			graphType,
			steps: [
				{
					id: "agent_completion_1",
					name: "agent-completion",
					enabled: true,
					config: { tools: [noopTool] },
				},
			],
		} as never,
	);
	const state = getInitialState({
		messages: [
			{ role: "system", content: "Be helpful." },
			{ role: "user", content: "what is this?" },
		],
		contextQueries: [],
		reminders: ["Current page: https://x.test/listing/1"],
	});
	for await (const _ of await graph.stream(state, { streamMode: "values" })) {
		// drain
	}
	return requests;
};

describe("reminders handed to a chat graph", () => {
	for (const graphType of ["agent", "foundation"] as const) {
		it(`attaches them after the conversation in the ${graphType} graph`, async () => {
			const requests = await runWithReminders(graphType);

			expect(requests).toHaveLength(1);
			const messages = requests[0]?.messages ?? [];
			expect(messages.at(-1)).toEqual({
				role: "user",
				content: expect.stringContaining(
					"<system-reminder>\nCurrent page: https://x.test/listing/1",
				),
			});
			// Not in the system prompt, where it would change the opening bytes.
			const system = messages.find((message) => message.role === "system");
			expect(String(system?.content)).not.toContain("x.test");
		});
	}
});
