import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentGraph } from "flow-core/graph/agent/graph";
import type { AgentState } from "flow-core/graph/agent/state";
import type { GraphTool } from "flow-core/graph/graph.base";
import type {
	ChatCompletionChunk,
	ChatCompletionRequest,
} from "flow-core/interfaces/engine/messages";
import type { IFlowLLMService } from "flow-core/interfaces/services/llm";
import type { BaseTool } from "flow-core/interfaces/engine/tool";
import { createFlowEngine } from "flow-core/runtime/flow-engine";
import { createFlowRegistries } from "flow-core/registries/registry-set";

const agentInput = (): Partial<AgentState> => ({
	messages: [{ role: "user", content: "Use the tool" }],
	outputMessages: [],
	tools: [],
	response: "",
	maxIterations: 4,
	currentIteration: 0,
});

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
	finish_reason: ChatCompletionChunk["choices"][number]["finish_reason"] = null,
): ChatCompletionChunk => ({
	id: `chunk-${Math.random()}`,
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [{ index: 0, delta, finish_reason }],
});

async function* streamChunks(
	...chunks: ChatCompletionChunk[]
): AsyncIterable<ChatCompletionChunk> {
	for (const item of chunks) {
		yield item;
	}
}

const readyLlm = (
	chatCompletions: IFlowLLMService["chatCompletions"],
): IFlowLLMService => ({
	isReady: () => true,
	getCurrentModel: async () => ({ modelId: "test-model" }),
	getMaxModelTokens: async () => 4096,
	getMaxResponseTokens: async () => 1024,
	chatCompletions,
});

const registerParallelAgentGraph = (
	registries: ReturnType<typeof createFlowRegistries>,
): void => {
	registries.graphs.register(
		"parallel-agent-test",
		(services, config, context) =>
			new AgentGraph(services, config, context?.registries),
		{ stepOrder: [] },
	);
};

const toolByName = (name: string, result: string): BaseTool => ({
	name,
	description: `${name} test tool`,
	schema: z.object({}),
	execute: async () => result,
});

describe("FlowEngine harness behavior", () => {
	it("keeps same tool names isolated across concurrent engine instances", async () => {
		const createEngineRun = (toolResult: string) => {
			const registries = createFlowRegistries();
			registerParallelAgentGraph(registries);
			registries.tools.setEntry({
				id: "shared_tool",
				name: "shared_tool",
				factory: () => toolByName("shared_tool", toolResult),
				config: {},
				metadata: {},
			});

			const llm = readyLlm((request) => {
				const body = request as ChatCompletionRequest;
				const toolMessage = body.messages.findLast(
					(message) => message.role === "tool",
				);
				if (toolMessage) {
					return streamChunks(
						chunk({ content: `answer:${toolMessage.content}` }, "stop"),
					);
				}
				return streamChunks(
					chunk(
						{
							tool_calls: [
								{
									index: 0,
									id: "call_shared",
									type: "function",
									function: {
										name: "shared_tool",
										arguments: "{}",
									},
								},
							],
						},
						"tool_calls",
					),
				);
			});

			const graph = createFlowEngine({ registries }).createGraph(
				"parallel-agent-test",
				{ llm },
				{ tools: ["shared_tool" as GraphTool] },
			);
			return graph.invoke(agentInput());
		};

		const [first, second] = await Promise.all([
			createEngineRun("A"),
			createEngineRun("B"),
		]);

		expect(first.response).toBe("answer:A");
		expect(second.response).toBe("answer:B");
	});

	it("emits LLM and tool execution events through the writer contract", async () => {
		const events: Array<{ type?: string; [key: string]: unknown }> = [];
		const tool = toolByName("event_tool", "tool-result");
		const graph = new AgentGraph(
			{
				llm: readyLlm(() =>
					streamChunks(
						chunk(
							{
								tool_calls: [
									{
										index: 0,
										id: "call_event",
										type: "function",
										function: {
											name: "event_tool",
											arguments: "{}",
										},
									},
								],
							},
							"tool_calls",
						),
					),
				),
			},
			{ tools: [tool] },
		);
		const runConfig = {
			writer: (event: { type?: string; [key: string]: unknown }) =>
				events.push(event),
		};

		const agentResult = await graph.agentNode(
			{
				...agentInput(),
				messages: [{ role: "user", content: "call event tool" }],
			} as AgentState,
			runConfig as never,
		);
		await graph.toolsNode(
			{
				...agentInput(),
				outputMessages: agentResult.outputMessages ?? [],
			} as AgentState,
			runConfig as never,
		);

		expect(events.some((event) => event.type === "llm")).toBe(true);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "execute-start",
					node: "tool_executor",
					metadata: expect.objectContaining({
						tool: "event_tool",
						tool_call_id: "call_event",
					}),
				}),
			]),
		);
		expect(
			events.some(
				(event) =>
					event.type === "llm" &&
					(event.chunk as ChatCompletionChunk | undefined)?.choices?.[0]?.delta
						.role === "tool",
			),
		).toBe(true);
	});

	it("fails clearly when the LLM service is not ready", async () => {
		const graph = new AgentGraph(
			{
				llm: {
					...readyLlm(() => streamChunks(chunk({ content: "unused" }))),
					isReady: () => false,
				},
			},
			{ tools: [] },
		);

		await expect(graph.agentNode(agentInput() as AgentState)).rejects.toThrow(
			"LLM service is not ready",
		);
	});
});

declare global {
	interface ToolTypeRegistry {
		shared_tool: {
			input: Record<string, never>;
			services: void;
		};
	}

	interface GraphTypeRegistry {
		"parallel-agent-test": {
			services: ConstructorParameters<typeof AgentGraph>[0];
			config: ConstructorParameters<typeof AgentGraph>[1];
			graph: AgentGraph;
		};
	}
}
