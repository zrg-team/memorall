import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessagePartsAccumulator } from "@/services/chat/message-parts";
import type { ChatCompletionChunk } from "@/types/openai";
import { StreamBuffer } from "../stream-buffer";
import type {
	ItemHandlerResult,
	JobProgressUpdate,
	ProcessDependencies,
} from "../types";

// ─── Boundaries the chat handler talks to ────────────────────────────────────
// Everything below the model and the flow engine is stubbed; the handler, the
// stream buffer, the chunk dispatcher and the message-parts accumulator are the
// real thing, so what these tests count is what actually crosses the wire.

const llmStream = vi.fn<() => AsyncIterable<ChatCompletionChunk>>();
const flowStream = vi.fn<() => AsyncIterable<unknown>>();

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		initialize: vi.fn(async () => undefined),
		readFile: vi.fn(async () => new Uint8Array()),
	},
}));

vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			getCurrentModel: vi.fn(async () => ({ provider: "mock" })),
			chatCompletions: vi.fn(() => llmStream()),
		},
		embeddingService: {},
		databaseService: { use: vi.fn(async () => undefined) },
		flowBuilderService: { getUnifiedFlowConfig: vi.fn(async () => null) },
		getSandboxContainerService: vi.fn(() => ({})),
		getWebBrowserService: vi.fn(() => ({})),
	},
}));

vi.mock("@/services/flow-service-adapters", () => ({
	consoleFlowLogger: {},
	toFlowDatabase: vi.fn(() => ({})),
	toFlowEmbedding: vi.fn(() => ({})),
	toFlowFileSystem: vi.fn(() => ({})),
	toFlowLLM: vi.fn(() => ({})),
	toFlowMcpStdio: vi.fn(() => undefined),
	toFlowSandbox: vi.fn(() => ({})),
	toFlowWebBrowser: vi.fn(() => ({})),
	toAgentSandbox: vi.fn(() => ({})),
	withPromptCacheKey: vi.fn((llm, promptCacheKey) => ({
		...llm,
		promptCacheKey,
	})),
}));

vi.mock("@/services/agent-harness", () => ({
	createMemorallFlowRun: vi.fn(() => ({ run: "mock" })),
	toLegacyFlowStream: vi.fn(() => flowStream()),
}));

vi.mock("@/services/mcp-connections", () => ({
	withResolvedConnections: vi.fn(async (config: unknown) => config),
}));

const chunk = (
	delta: ChatCompletionChunk["choices"][number]["delta"],
): ChatCompletionChunk => ({
	id: "chunk",
	object: "chat.completion.chunk",
	created: 1,
	model: "test-model",
	choices: [{ index: 0, delta, finish_reason: null }],
});

describe("StreamBuffer", () => {
	it("buffers until the word threshold and flushes remaining content", () => {
		const onEmit = vi.fn();
		const buffer = new StreamBuffer(3, onEmit);

		buffer.add("hello ");
		expect(onEmit).not.toHaveBeenCalled();
		expect(buffer.peek()).toBe("hello ");

		buffer.add("world again");
		expect(onEmit).toHaveBeenCalledWith("hello world again");
		expect(buffer.peek()).toBe("");

		buffer.add("tail");
		buffer.flush();
		expect(onEmit).toHaveBeenLastCalledWith("tail");
	});
});

describe("MessagePartsAccumulator", () => {
	it("accumulates assistant content, tool calls, and tool results in order", () => {
		const accumulator = new MessagePartsAccumulator();

		accumulator.addChunk(chunk({ role: "assistant", content: "Hello " }));
		accumulator.addChunk(chunk({ content: "world" }));
		accumulator.addChunk(
			chunk({
				tool_calls: [
					{
						index: 0,
						id: "call-1",
						type: "function",
						function: { name: "lookup", arguments: '{"q"' },
					},
				],
			}),
		);
		accumulator.addChunk(
			chunk({
				tool_calls: [
					{
						index: 0,
						type: "function",
						function: { arguments: ':"x"}' },
					},
				],
			}),
		);
		accumulator.addChunk(
			chunk({ role: "tool", tool_call_id: "call-1", content: "result" }),
		);

		expect(accumulator.toParts()).toEqual([
			{
				role: "assistant",
				content: "Hello world",
				tool_calls: [
					{
						id: "call-1",
						type: "function",
						function: { name: "lookup", arguments: '{"q":"x"}' },
					},
				],
			},
			{ role: "tool", content: "result", tool_call_id: "call-1" },
		]);
	});
});

// ─── Streaming integration ───────────────────────────────────────────────────

type Dispatch = { stage: string; result?: Record<string, unknown> };

const createRecorder = () => {
	const dispatches: Dispatch[] = [];
	const dependencies: ProcessDependencies = {
		logger: {
			info: vi.fn(async () => undefined),
			error: vi.fn(async () => undefined),
			warn: vi.fn(async () => undefined),
			debug: vi.fn(async () => undefined),
		},
		updateJobProgress: vi.fn(async (_id: string, p: JobProgressUpdate) => {
			dispatches.push({
				stage: p.stage,
				result: p.result as Record<string, unknown> | undefined,
			});
		}),
		completeJob: vi.fn(async () => undefined),
	};
	return { dependencies, dispatches };
};

const chunkResults = (dispatches: Dispatch[]) =>
	dispatches
		.map((d) => d.result)
		.filter(
			(r): r is { type: "chunk"; chunk: ChatCompletionChunk } =>
				r?.type === "chunk" && Boolean(r.chunk),
		);

const streamedText = (dispatches: Dispatch[]) =>
	chunkResults(dispatches)
		.map((r) => r.chunk.choices?.[0]?.delta?.content ?? "")
		.join("");

/** Chunks whose only job is to carry structure, not text. */
const metadataChunks = (dispatches: Dispatch[]) =>
	chunkResults(dispatches).filter((r) => !r.chunk.choices?.[0]?.delta?.content);

const runChat = async (payload: Record<string, unknown>) => {
	const { ChatHandler } = await import("../process-chat");
	const { dependencies, dispatches } = createRecorder();
	const result = (await new ChatHandler().process(
		"job-1",
		{
			id: "job-1",
			jobType: "chat",
			status: "pending",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			progress: [],
			payload,
		} as never,
		dependencies,
	)) as ItemHandlerResult & Record<string, unknown>;
	return { result, dispatches };
};

describe("chat streaming over a mock LLM", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("streams every token's text while announcing the assistant role once", async () => {
		const words = Array.from({ length: 40 }, (_, i) => `word${i} `);

		llmStream.mockImplementation(async function* () {
			for (const word of words) {
				// Providers that repeat `role` on every delta used to force one
				// cross-context message per token on top of the buffered content.
				yield chunk({ role: "assistant", content: word });
			}
			yield {
				id: "final",
				object: "chat.completion.chunk",
				created: 1,
				model: "test-model",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			} as ChatCompletionChunk;
		});

		const { result, dispatches } = await runChat({
			messages: [{ role: "user", content: "hi" }],
			model: "test-model",
			mode: "normal",
		});

		const expected = words.join("");
		// Nothing is dropped or reordered by the throttle.
		expect(streamedText(dispatches)).toBe(expected);
		expect(result.content).toBe(expected);

		// Exactly two structural chunks: the first role announcement and the
		// finish reason. Forty repeats of `role: "assistant"` carry nothing new.
		expect(metadataChunks(dispatches)).toHaveLength(2);
		expect(chunkResults(dispatches).length).toBeLessThan(words.length / 2);
	});

	it("streams a reasoning model's thinking and joins tool-call fragments", async () => {
		llmStream.mockImplementation(async function* () {
			yield chunk({ role: "assistant", reasoning: "Let me " });
			yield chunk({ reasoning: "check." });
			yield chunk({
				tool_calls: [
					{
						index: 0,
						id: "call-1",
						type: "function",
						function: { name: "lookup", arguments: "" },
					},
				],
			});
			for (const piece of ['{"q"', ':"x"', "}"]) {
				yield chunk({
					tool_calls: [{ index: 0, function: { arguments: piece } }],
				});
			}
		});

		const { dispatches } = await runChat({
			messages: [{ role: "user", content: "hi" }],
			model: "test-model",
			mode: "normal",
		});

		const deltas = chunkResults(dispatches).map(
			(r) => r.chunk.choices?.[0]?.delta,
		);
		// The thinking reaches the UI as it streams, in its own field.
		expect(deltas.map((delta) => delta?.reasoning ?? "").join("")).toBe(
			"Let me check.",
		);
		// The call arrives whole, without a message per argument fragment.
		const fragments = deltas.flatMap((delta) => delta?.tool_calls ?? []);
		expect(
			fragments.map((call) => call.function?.arguments ?? "").join(""),
		).toBe('{"q":"x"}');
		expect(fragments.length).toBeLessThan(4);
	});

	it("puts the first token on the wire without waiting for a word threshold", async () => {
		llmStream.mockImplementation(async function* () {
			yield chunk({ role: "assistant", content: "Hel" });
			yield chunk({ content: "lo there" });
			yield chunk({ content: " friend" });
		});

		const { dispatches } = await runChat({
			messages: [{ role: "user", content: "hi" }],
			model: "test-model",
			mode: "normal",
		});

		const firstText = chunkResults(dispatches)
			.map((r) => r.chunk.choices?.[0]?.delta?.content)
			.find((content): content is string => Boolean(content));

		// Not "Hello there friend" — the reader sees the first fragment as soon as
		// the model produces it, rather than after five words have accumulated.
		expect(firstText).toBe("Hel");
		expect(streamedText(dispatches)).toBe("Hello there friend");
	});

	it("merges buffered fragments instead of one message per emission", async () => {
		llmStream.mockImplementation(async function* () {
			for (let i = 0; i < 60; i += 1) {
				yield chunk({ content: `tok${i} ` });
			}
		});

		const { dispatches } = await runChat({
			messages: [{ role: "user", content: "hi" }],
			model: "test-model",
			mode: "normal",
			streamConfig: { minWordsToStream: 1, streamToolCallsImmediately: true },
		});

		// minWordsToStream: 1 asks the buffer to emit on every token. The
		// dispatcher is what decides how often that reaches the other side.
		expect(streamedText(dispatches)).toBe(
			Array.from({ length: 60 }, (_, i) => `tok${i} `).join(""),
		);
		expect(chunkResults(dispatches).length).toBeLessThan(10);
	});
});

describe("agent flow with multiple steps over a mock LLM", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const scriptedFlow = () =>
		vi.fn(async function* () {
			yield ["custom", { type: "execute-start", node: "plan" }];
			yield [
				"custom",
				{
					type: "llm",
					chunk: chunk({ role: "assistant", content: "Let me " }),
				},
			];
			yield [
				"custom",
				{
					type: "llm",
					chunk: chunk({ role: "assistant", content: "check the weather " }),
				},
			];
			yield [
				"custom",
				{
					type: "execute-start",
					node: "tool",
					metadata: {
						tool: "get_weather",
						tool_call_id: "call-1",
						input: { city: "Hanoi" },
					},
				},
			];
			yield [
				"custom",
				{
					type: "tool-result",
					node: "tool",
					metadata: {
						tool: "get_weather",
						tool_call_id: "call-1",
						content: '{"tempC":31}',
					},
				},
			];
			yield [
				"custom",
				{
					type: "llm",
					chunk: chunk({ role: "assistant", content: "It is 31C in Hanoi." }),
				},
			];
			yield [
				"custom",
				{
					type: "actions",
					actions: [{ id: "a1", name: "weather", description: "looked up" }],
				},
			];
			yield [
				"values",
				{
					response: "Let me check the weather It is 31C in Hanoi.",
					outputMessages: [
						{
							role: "assistant",
							content: "Let me check the weather It is 31C in Hanoi.",
						},
					],
				},
			];
		});

	it("keeps step events in order and records each tool execution once", async () => {
		flowStream.mockImplementation(scriptedFlow());

		const { result, dispatches } = await runChat({
			messages: [{ role: "user", content: "weather in Hanoi?" }],
			model: "test-model",
			mode: "agent",
		});

		// Index-aligned with `dispatches` so slicing by event position is valid.
		const types = dispatches.map(
			(d) => (d.result?.type as string | undefined) ?? null,
		);

		// Text produced before a step event must reach the consumer before that
		// event does, or the transcript renders out of order.
		const firstToolEvent = types.indexOf("tool-execution");
		expect(firstToolEvent).toBeGreaterThan(-1);
		expect(streamedText(dispatches.slice(0, firstToolEvent))).toBe(
			"Let me check the weather ",
		);

		expect(types.filter((t) => t === "execute-start")).toHaveLength(2);
		expect(types).toContain("action");
		expect(types.at(-1)).toBe("final");

		// One role announcement for the whole multi-step run, not one per chunk.
		expect(metadataChunks(dispatches)).toHaveLength(1);

		const metadata = result.metadata as Record<string, unknown>;
		expect(metadata.toolExecutions).toEqual([
			expect.objectContaining({
				id: "call-1",
				name: "get_weather",
				status: "completed",
				outputPreview: expect.stringContaining("31"),
			}),
		]);
		expect(result.content).toBe("Let me check the weather It is 31C in Hanoi.");
		expect(result.parts).toEqual([
			{
				role: "assistant",
				content: "Let me check the weather It is 31C in Hanoi.",
			},
		]);
	});
});

describe("stopping a run keeps it like a finished one", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const job = (id: string, jobType: string, payload: unknown) =>
		({
			id,
			jobType,
			status: "pending",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			progress: [],
			payload,
		}) as never;

	const startRun = async (payload: Record<string, unknown>) => {
		const { ChatHandler } = await import("../process-chat");
		const handler = new ChatHandler();
		const { dependencies, dispatches } = createRecorder();
		const stop = () =>
			handler.process(
				"stop-1",
				job("stop-1", "stop-chat", { targetJobId: "job-1" }),
				dependencies,
			);
		const run = () =>
			handler.process(
				"job-1",
				job("job-1", "chat", payload),
				dependencies,
			) as Promise<Record<string, unknown>>;
		return { stop, run, dispatches };
	};

	it("ends the request in flight and books an estimate for its tokens", async () => {
		let stop: () => Promise<unknown> = async () => undefined;
		let streamedPastStop = false;
		llmStream.mockImplementation(async function* () {
			yield chunk({ role: "assistant", content: "Hello " });
			await stop();
			yield chunk({ content: "world" });
			streamedPastStop = true;
			yield chunk({ content: " and more" });
		});

		const started = await startRun({
			messages: [{ role: "user", content: "hi" }],
			model: "test-model",
			mode: "normal",
		});
		stop = started.stop;
		const result = await started.run();

		expect(streamedPastStop).toBe(false);
		expect(result.type).toBe("final");
		expect(result.content).toBe("Hello world");
		const metadata = result.metadata as Record<string, unknown>;
		expect(metadata.stopped).toBe(true);
		// The provider never sent usage for the cut-off request; it still counts.
		expect(metadata.usage).toEqual(
			expect.objectContaining({ requests: 1, estimated: true }),
		);
		expect(metadata.estimatedTokens).toBeGreaterThan(0);
		const { serviceManager } = await import("@/services");
		const request = vi
			.mocked(serviceManager.llmService.chatCompletions)
			.mock.calls.at(-1)?.[0] as { signal?: AbortSignal };
		expect(request.signal?.aborted).toBe(true);
	});

	it("stops the agent loop and keeps its steps, tool calls and usage", async () => {
		let stop: () => Promise<unknown> = async () => undefined;
		flowStream.mockImplementation(async function* () {
			yield ["custom", { type: "execute-start", node: "plan" }];
			yield [
				"custom",
				{
					type: "llm",
					chunk: {
						...chunk({ role: "assistant", content: "Checking." }),
						usage: {
							prompt_tokens: 100,
							completion_tokens: 5,
							total_tokens: 105,
						},
					},
				},
			];
			yield [
				"custom",
				{
					type: "execute-start",
					node: "tool",
					metadata: { tool: "web_open", tool_call_id: "call-1", input: {} },
				},
			];
			await stop();
			// What the harness does once the run's signal is aborted.
			throw new Error("cancelled");
		});

		const started = await startRun({
			messages: [{ role: "user", content: "open it" }],
			model: "test-model",
			mode: "agent",
			conversation: { id: "conversation-1", inProgressMessage: { id: "m-1" } },
		});
		stop = started.stop;
		const result = await started.run();

		const { createMemorallFlowRun } = await import("@/services/agent-harness");
		const runOptions = vi.mocked(createMemorallFlowRun).mock.calls.at(-1)?.[0];
		expect(runOptions?.signal?.aborted).toBe(true);

		expect(result.type).toBe("final");
		expect(result.content).toBe("Checking.");
		const metadata = result.metadata as Record<string, unknown>;
		expect(metadata.stopped).toBe(true);
		expect(metadata.error).toBeUndefined();
		expect(metadata.usage).toEqual(
			expect.objectContaining({ total_tokens: 105, requests: 1 }),
		);
		expect(metadata.executions).toEqual([
			expect.objectContaining({ node: "plan", state: "complete" }),
		]);
		expect(metadata.toolExecutions).toEqual([
			expect.objectContaining({ id: "call-1", status: "cancelled" }),
		]);
		expect(started.dispatches.map((d) => d.stage)).not.toContain("Chat failed");
	});

	it("honours a stop that arrives before the run starts", async () => {
		const started = await startRun({
			messages: [{ role: "user", content: "hi" }],
			model: "test-model",
			mode: "normal",
		});
		await started.stop();
		const result = await started.run();

		expect(result.type).toBe("final");
		expect((result.metadata as Record<string, unknown>).stopped).toBe(true);
	});
});

describe("messages sent into a run in progress", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const job = (id: string, jobType: string, payload: unknown) =>
		({
			id,
			jobType,
			status: "pending",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			progress: [],
			payload,
		}) as never;

	it("reaches the run's inbox while it runs, and is kept where the agent read it", async () => {
		const { ChatHandler } = await import("../process-chat");
		const { FLOW_RUN_INBOX_RUNTIME_KEY } = await import(
			"@memorall/agent-harness-flows/context/run-inbox"
		);
		const { createMemorallFlowRun } = await import("@/services/agent-harness");
		const handler = new ChatHandler();
		const { dependencies, dispatches } = createRecorder();
		const inject = (content: string) =>
			handler.process(
				"inject-1",
				job("inject-1", "inject-chat-message", {
					targetJobId: "job-1",
					message: { id: "m-1", content },
				}),
				dependencies,
			);

		// No run yet: refused, so the sender sends it as a new message.
		expect(await inject("too early")).toEqual({ accepted: false });

		let taken: unknown;
		flowStream.mockImplementation(async function* () {
			yield [
				"custom",
				{
					type: "llm",
					chunk: chunk({ role: "assistant", content: "Reading." }),
				},
			];
			expect(await inject("Also check the logs")).toEqual({ accepted: true });
			// What the agent loop does before its next request.
			const runtimeVars = vi
				.mocked(createMemorallFlowRun)
				.mock.calls.at(-1)?.[0].input.runtimeVars as Record<
				string,
				{ take: () => unknown }
			>;
			taken = runtimeVars[FLOW_RUN_INBOX_RUNTIME_KEY]?.take();
			yield [
				"custom",
				{ type: "user-message", id: "m-1", content: "Also check the logs" },
			];
			yield [
				"custom",
				{ type: "llm", chunk: chunk({ role: "assistant", content: "Done." }) },
			];
		});

		const result = (await handler.process(
			"job-1",
			job("job-1", "chat", {
				messages: [{ role: "user", content: "read it" }],
				model: "test-model",
				mode: "agent",
			}),
			dependencies,
		)) as Record<string, unknown>;

		expect(taken).toEqual([{ id: "m-1", content: "Also check the logs" }]);
		expect(
			dispatches.find((d) => d.result?.type === "user-message")?.result,
		).toEqual({
			type: "user-message",
			id: "m-1",
			content: "Also check the logs",
		});
		expect(result.parts).toEqual([
			{ role: "assistant", content: "Reading." },
			// Stored as the agent read it, so the next turn sends the same bytes.
			{
				role: "user",
				content: "<by-the-way>\nAlso check the logs\n</by-the-way>",
			},
			{ role: "assistant", content: "Done." },
		]);
		// The run is over: refused again.
		expect(await inject("too late")).toEqual({ accepted: false });
	});
});

describe("a split conversation does not turn plain chat into an agent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const splitConversation = {
		id: "conversation-1",
		historyBoundary: {
			separatorId: "separator-1",
			createdAt: "2026-01-01T00:00:00.000Z",
		},
	};

	const singleReply = (text: string) =>
		vi.fn(async function* () {
			yield chunk({ role: "assistant", content: text });
			yield {
				id: "final",
				object: "chat.completion.chunk",
				created: 1,
				model: "test-model",
				choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
			} as ChatCompletionChunk;
		});

	it("keeps normal mode on the direct completion path past a separator", async () => {
		// Splitting used to escalate every plain message to a full agent run so it
		// could reach the history tools. Recall is a flow feature now, so "Chat"
		// stays a single completion over the messages after the split.
		llmStream.mockImplementation(singleReply("only what I can see"));
		const { createMemorallFlowRun } = await import("@/services/agent-harness");

		const { result } = await runChat({
			messages: [{ role: "user", content: "what did we decide?" }],
			model: "test-model",
			mode: "normal",
			conversation: splitConversation,
		});

		expect(createMemorallFlowRun).not.toHaveBeenCalled();
		expect(result.content).toBe("only what I can see");
	});

	it("hands the separator to the flow as runtime vars in agent mode", async () => {
		flowStream.mockImplementation(
			vi.fn(async function* () {
				yield ["values", { response: "found it" }];
			}),
		);
		const { createMemorallFlowRun } = await import("@/services/agent-harness");

		await runChat({
			messages: [{ role: "user", content: "what did we decide?" }],
			model: "test-model",
			mode: "agent",
			conversation: splitConversation,
		});

		expect(createMemorallFlowRun).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					runtimeVars: {
						"conversation.id": "conversation-1",
						"run.id": expect.stringMatching(/^chat:/),
						"thread.history.conversationId": "conversation-1",
						"thread.history.separatorId": "separator-1",
						// What the user writes while the run goes on.
						__flowRunInbox: expect.objectContaining({
							push: expect.any(Function),
							take: expect.any(Function),
						}),
					},
				}),
			}),
		);
	});

	it("routes every request of the run to the conversation's prompt cache", async () => {
		flowStream.mockImplementation(
			vi.fn(async function* () {
				yield ["values", { response: "found it" }];
			}),
		);
		const { createMemorallFlowRun } = await import("@/services/agent-harness");

		await runChat({
			messages: [{ role: "user", content: "what did we decide?" }],
			model: "test-model",
			mode: "agent",
			conversation: splitConversation,
		});

		expect(createMemorallFlowRun).toHaveBeenCalledWith(
			expect.objectContaining({
				services: expect.objectContaining({
					llm: expect.objectContaining({
						promptCacheKey: "memorall:conversation:conversation-1",
					}),
				}),
			}),
		);
	});

	it("seeds per-request context into the flow as reminders", async () => {
		// The co-agent's page and anchor change with every question; seeded as
		// reminders they ride past the end of each request instead of rewriting
		// the system prompt the cached prefix starts with.
		flowStream.mockImplementation(
			vi.fn(async function* () {
				yield ["values", { response: "ok" }];
			}),
		);
		const { createMemorallFlowRun } = await import("@/services/agent-harness");

		await runChat({
			messages: [{ role: "user", content: "what is this?" }],
			model: "test-model",
			mode: "custom",
			conversation: splitConversation,
			reminders: ["Current page: https://x.test/"],
		});

		expect(createMemorallFlowRun).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					initialState: expect.objectContaining({
						reminders: ["Current page: https://x.test/"],
					}),
				}),
			}),
		);
	});

	it("appends reminders after the conversation on the direct completion path", async () => {
		llmStream.mockImplementation(singleReply("ok"));
		const { serviceManager } = await import("@/services");

		await runChat({
			messages: [
				{ role: "system", content: "Be terse." },
				{ role: "user", content: "what is this?" },
			],
			model: "test-model",
			mode: "normal",
			reminders: ["Current page: https://x.test/"],
		});

		const request = vi
			.mocked(serviceManager.llmService.chatCompletions)
			.mock.calls.at(-1)?.[0] as {
			messages: Array<{ role: string; content: unknown }>;
		};
		expect(request.messages.slice(0, 2)).toEqual([
			{ role: "system", content: "Be terse." },
			{ role: "user", content: "what is this?" },
		]);
		expect(request.messages.at(-1)).toEqual({
			role: "user",
			content: expect.stringContaining("Current page: https://x.test/"),
		});
	});
});
