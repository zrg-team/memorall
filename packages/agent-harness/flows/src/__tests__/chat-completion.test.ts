import { describe, expect, it, vi } from "vitest";
import { createChatCompletionStep } from "../steps/common/chat-completion.js";
import type { ChatCompletionChunk } from "../interfaces/engine/messages.js";

const textChunk = (text: string): ChatCompletionChunk =>
  ({
    id: "c",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  }) as ChatCompletionChunk;

/**
 * OpenAI-compatible providers asked for `stream_options: { include_usage: true }`
 * answer with a final chunk carrying usage and `choices: []`. Reading
 * `choices[0].delta` on that chunk threw, which took down the whole step.
 */
const usageOnlyChunk = (): ChatCompletionChunk =>
  ({
    id: "c",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  }) as unknown as ChatCompletionChunk;

const llmWith = (chunks: ChatCompletionChunk[]) => ({
  isReady: () => true,
  chatCompletions: vi.fn(async function* () {
    for (const chunk of chunks) yield chunk;
  }),
});

describe("chat-completion step", () => {
  it("survives a usage-only chunk and keeps the text around it", async () => {
    const llm = llmWith([
      textChunk("Hello "),
      usageOnlyChunk(),
      textChunk("world"),
    ]);
    const step = createChatCompletionStep({ llm } as never, { stream: true });

    const result = await step.execute({
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    expect(result.output?.response).toBe(
      "Hello world",
    );
  });

  it("forwards every chunk to the writer, usage included", async () => {
    const llm = llmWith([textChunk("a"), usageOnlyChunk()]);
    const step = createChatCompletionStep({ llm } as never, { stream: true });
    const writer = vi.fn();

    await step.execute(
      { messages: [{ role: "user", content: "hi" }], stream: true },
      { writer } as never,
    );

    expect(writer).toHaveBeenCalledTimes(2);
  });

  it("reads a non-streaming response with no choices without throwing", async () => {
    const llm = {
      isReady: () => true,
      chatCompletions: vi.fn(async () => ({ choices: [] })),
    };
    const step = createChatCompletionStep({ llm } as never, { stream: false });

    const result = await step.execute({
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    });

    expect(result.output?.response).toBe("");
  });
});
