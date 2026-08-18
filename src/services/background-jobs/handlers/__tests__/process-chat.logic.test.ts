import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessagePartsAccumulator } from "@/services/chat/message-parts";
import { StreamBuffer } from "../stream-buffer";
import type { ChatCompletionChunk } from "@/types/openai";
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
	toFlowSandbox: vi.fn(() => ({})),
	toFlowWebBrowser: vi.fn(() => ({})),
	toAgentSandbox: vi.fn(() => ({})),
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
