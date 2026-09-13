import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalOpenAICompatibleLLM } from "../local-openai-llm";
import {
	derivePromptCacheKey,
	OpenAILLM,
	withCacheBreakpoints,
} from "../openai-llm";

type OpenAICompatibleLLM = OpenAILLM | LocalOpenAICompatibleLLM;

interface ProviderCase {
	name: "OpenAI" | "OpenRouter" | "LM Studio" | "Ollama";
	create: () => OpenAICompatibleLLM;
	baseURL: string;
	expectedAuthorization?: string;
	expectedInfoType: string;
}

const providers: ProviderCase[] = [
	{
		name: "OpenAI",
		create: () => new OpenAILLM("openai-key", "https://openai.test/v1"),
		baseURL: "https://openai.test/v1",
		expectedAuthorization: "Bearer openai-key",
		expectedInfoType: "openai",
	},
	{
		name: "OpenRouter",
		create: () =>
			new OpenAILLM("openrouter-key", "https://openrouter.test/api/v1"),
		baseURL: "https://openrouter.test/api/v1",
		expectedAuthorization: "Bearer openrouter-key",
		expectedInfoType: "openai",
	},
	{
		name: "LM Studio",
		create: () =>
			new LocalOpenAICompatibleLLM(
				"http://lmstudio.test/v1",
				undefined,
				"lmstudio",
			),
		baseURL: "http://lmstudio.test/v1",
		expectedInfoType: "lmstudio",
	},
	{
		name: "Ollama",
		create: () =>
			new LocalOpenAICompatibleLLM(
				"http://ollama.test/v1",
				undefined,
				"ollama",
			),
		baseURL: "http://ollama.test/v1",
		expectedInfoType: "ollama",
	},
];

function createFetchMock() {
	return vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/models")) {
			return Response.json({
				object: "list",
				data: [{ id: "contract-model", owned_by: "contract" }],
			});
		}

		const body = JSON.parse(String(init?.body ?? "{}"));
		if (body.stream) {
			const events = [
				`data: ${JSON.stringify({
					id: "stream-1",
					object: "chat.completion.chunk",
					created: 1,
					model: "contract-model",
					choices: [
						{
							index: 0,
							delta: { role: "assistant", content: "streamed" },
							finish_reason: null,
						},
					],
				})}\n\n`,
				`data: ${JSON.stringify({
					id: "stream-usage",
					object: "chat.completion.chunk",
					created: 1,
					model: "contract-model",
					choices: [],
					usage: {
						prompt_tokens: 3,
						completion_tokens: 2,
						total_tokens: 5,
					},
				})}\n\n`,
				"data: [DONE]\n\n",
			].join("");
			return new Response(events, {
				headers: { "Content-Type": "text/event-stream" },
			});
		}

		return Response.json({
			id: "completion-1",
			object: "chat.completion",
			created: 1,
			model: "contract-model",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "completed" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
		});
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("OpenAI-compatible provider contracts", () => {
	it("rejects a remote provider without credentials before chat can start", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const llm = new OpenAILLM(undefined, "https://openrouter.ai/api/v1");

		await expect(llm.initialize()).rejects.toThrow(
			"API key is required for remote AI providers",
		);
		expect(llm.getInfo().ready).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(providers)(
		"$name lists models and handles completion plus streaming",
		async ({ create, baseURL, expectedAuthorization, expectedInfoType }) => {
			const fetchMock = createFetchMock();
			vi.stubGlobal("fetch", fetchMock);

			const llm = create();
			await llm.initialize();
			expect(llm.getInfo()).toMatchObject({
				type: expectedInfoType,
				ready: true,
			});

			await expect(llm.models()).resolves.toMatchObject({
				object: "list",
				data: [{ id: "contract-model" }],
			});

			const completion = await llm.chatCompletions({
				model: "contract-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: false,
			});
			expect(completion.choices[0]?.message.content).toBe("completed");
			expect(completion.usage).toMatchObject({ total_tokens: 5 });

			const chunks = [];
			for await (const chunk of llm.chatCompletions({
				model: "contract-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: true,
			})) {
				chunks.push(chunk);
			}
			expect(chunks[0]?.choices[0]?.delta.content).toBe("streamed");
			expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("stop");

			const modelsRequest = fetchMock.mock.calls.find(
				([url]) => String(url) === `${baseURL}/models`,
			);
			expect(modelsRequest).toBeDefined();
			const completionRequest = fetchMock.mock.calls.find(
				([url, init]) =>
					String(url) === `${baseURL}/chat/completions` &&
					JSON.parse(String((init as RequestInit).body)).stream === false,
			);
			const streamRequest = fetchMock.mock.calls.find(
				([url, init]) =>
					String(url) === `${baseURL}/chat/completions` &&
					JSON.parse(String((init as RequestInit).body)).stream === true,
			);
			for (const request of [completionRequest, streamRequest]) {
				expect(request).toBeDefined();
				const headers = (request?.[1] as RequestInit).headers as Record<
					string,
					string
				>;
				expect(headers.Authorization).toBe(expectedAuthorization);
			}
		},
	);

	it.each(providers)(
		"$name forwards an AbortSignal to its HTTP request",
		async ({ create }) => {
			const fetchMock = vi.fn(
				(_input: string | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal as AbortSignal | undefined;
						if (signal?.aborted) {
							reject(new Error("Operation aborted"));
							return;
						}
						signal?.addEventListener(
							"abort",
							() => reject(new Error("Operation aborted")),
							{ once: true },
						);
					}),
			);
			vi.stubGlobal("fetch", fetchMock);

			const controller = new AbortController();
			const completion = create().chatCompletions({
				model: "contract-model",
				messages: [{ role: "user", content: "Hello" }],
				stream: false,
				signal: controller.signal,
			});
			controller.abort();

			await expect(completion).rejects.toThrow("Operation aborted");
			expect(fetchMock).toHaveBeenCalledTimes(1);
		},
	);
});

describe("OpenAI-compatible prompt-cache hints", () => {
	const streamWithUsage = (usage: Record<string, unknown>) =>
		[
			`data: ${JSON.stringify({
				id: "stream-1",
				object: "chat.completion.chunk",
				created: 1,
				model: "cache-model",
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "hi" },
						finish_reason: null,
					},
				],
			})}\n\n`,
			`data: ${JSON.stringify({
				id: "stream-usage",
				object: "chat.completion.chunk",
				created: 1,
				model: "cache-model",
				choices: [],
				usage,
			})}\n\n`,
			"data: [DONE]\n\n",
		].join("");

	const captureBody = (usage: Record<string, unknown>) => {
		const fetchMock = vi.fn(
			async (_input: string | URL, init?: RequestInit) => {
				const body = JSON.parse(String(init?.body ?? "{}"));
				if (body.stream) {
					return new Response(streamWithUsage(usage), {
						headers: { "Content-Type": "text/event-stream" },
					});
				}
				return Response.json({
					id: "completion-1",
					object: "chat.completion",
					created: 1,
					model: "cache-model",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "hi" },
							finish_reason: "stop",
						},
					],
					usage,
				});
			},
		);
		vi.stubGlobal("fetch", fetchMock);
		const lastInit = (): RequestInit => {
			const init = fetchMock.mock.calls.at(-1)?.[1];
			if (!init) throw new Error("fetch was not called");
			return init;
		};
		return {
			fetchMock,
			lastBody: () => JSON.parse(String(lastInit().body)),
			lastHeaders: () => lastInit().headers as Record<string, string>,
		};
	};

	const conversation = [
		{ role: "system" as const, content: "Be terse." },
		{ role: "user" as const, content: "First question" },
		{ role: "assistant" as const, content: "First answer" },
		{ role: "user" as const, content: "Second question" },
	];

	const openAIUsage = {
		prompt_tokens: 1200,
		completion_tokens: 20,
		total_tokens: 1220,
		prompt_tokens_details: { cached_tokens: 1024 },
		completion_tokens_details: { reasoning_tokens: 5 },
	};

	it("keeps the same prompt_cache_key across the turns of one conversation", async () => {
		const { lastBody } = captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://api.openai.com/v1");

		await llm.chatCompletions({
			model: "gpt-5.6-terra",
			messages: conversation.slice(0, 2),
			stream: false,
		});
		const firstKey = lastBody().prompt_cache_key;

		await llm.chatCompletions({
			model: "gpt-5.6-terra",
			messages: conversation,
			stream: false,
		});

		expect(firstKey).toMatch(/^memorall:[0-9a-f]{8}$/);
		expect(lastBody().prompt_cache_key).toBe(firstKey);
		expect(derivePromptCacheKey(conversation)).toBe(firstKey);
		expect(
			derivePromptCacheKey([{ role: "user", content: "Other thread" }]),
		).not.toBe(firstKey);
	});

	it("honours a caller-supplied prompt_cache_key", async () => {
		const { lastBody } = captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://api.openai.com/v1");

		await llm.chatCompletions({
			model: "gpt-5.6-terra",
			messages: conversation,
			stream: false,
			prompt_cache_key: "conversation:42",
		});

		expect(lastBody().prompt_cache_key).toBe("conversation:42");
	});

	it("sends no cache hints to a local OpenAI-compatible server", async () => {
		const { lastBody, lastHeaders } = captureBody(openAIUsage);
		const llm = new OpenAILLM("", "http://localhost:1234/v1");

		await llm.chatCompletions({
			model: "local-model",
			messages: conversation,
			stream: false,
		});

		const body = lastBody();
		expect(body.prompt_cache_key).toBeUndefined();
		expect(body.usage).toBeUndefined();
		expect(body.messages[0].content).toBe("Be terse.");
		expect(lastHeaders()["HTTP-Referer"]).toBeUndefined();
	});

	it("asks OpenRouter for cost accounting and uses automatic caching for Claude", async () => {
		const { lastBody, lastHeaders } = captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

		await llm.chatCompletions({
			model: "anthropic/claude-sonnet-4.5",
			messages: conversation,
			stream: false,
		});

		const body = lastBody();
		expect(body.usage).toEqual({ include: true });
		expect(body.prompt_cache_key).toMatch(/^memorall:/);
		expect(lastHeaders()["X-Title"]).toBe("Memorall");

		// Both breakpoints are explicit and long-lived: one on the system prompt
		// (which covers the tool definitions rendered ahead of it) and one at the
		// end of the conversation. The request-level marker Claude also accepts
		// is deliberately absent — it lands on the last block, which is the
		// volatile reminder tail whenever a run has one.
		expect(body.cache_control).toBeUndefined();
		expect(body.messages[0].content).toEqual([
			{
				type: "text",
				text: "Be terse.",
				cache_control: { type: "ephemeral", ttl: "1h" },
			},
		]);
		expect(body.messages[3].content).toEqual([
			{
				type: "text",
				text: "Second question",
				cache_control: { type: "ephemeral", ttl: "1h" },
			},
		]);
		// …and every message in between keeps its shape.
		expect(body.messages[1].content).toBe("First question");
		expect(body.messages[2].content).toBe("First answer");
		expect(body.prompt_cache_retention).toBeUndefined();
	});

	it("marks the system prompt and latest user message for Gemini via OpenRouter", async () => {
		const { lastBody } = captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

		await llm.chatCompletions({
			model: "google/gemini-2.5-pro",
			messages: conversation,
			stream: false,
		});

		const body = lastBody();
		expect(body.cache_control).toBeUndefined();
		expect(body.messages[0].content).toEqual([
			{ type: "text", text: "Be terse.", cache_control: { type: "ephemeral" } },
		]);
		expect(body.messages[3].content).toEqual([
			{
				type: "text",
				text: "Second question",
				cache_control: { type: "ephemeral" },
			},
		]);
		expect(body.messages[1].content).toBe("First question");
		expect(body.messages[2].content).toBe("First answer");
	});

	it("asks OpenAI for 24h retention only on models that support it", async () => {
		const { lastBody } = captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://api.openai.com/v1");

		for (const model of ["gpt-4.1", "gpt-5.1-codex", "gpt-5", "gpt-5.5-pro"]) {
			await llm.chatCompletions({
				model,
				messages: conversation,
				stream: false,
			});
			expect(lastBody().prompt_cache_retention).toBe("24h");
		}
		for (const model of ["gpt-5.6-terra", "gpt-4o", "gpt-4.1-mini", "o3"]) {
			await llm.chatCompletions({
				model,
				messages: conversation,
				stream: false,
			});
			expect(lastBody().prompt_cache_retention).toBeUndefined();
		}

		const router = new OpenAILLM("key", "https://openrouter.ai/api/v1");
		await router.chatCompletions({
			model: "openai/gpt-4.1",
			messages: conversation,
			stream: false,
		});
		expect(lastBody().prompt_cache_retention).toBeUndefined();
	});

	it("leaves messages untouched for OpenRouter models that cache automatically", async () => {
		const { lastBody } = captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

		await llm.chatCompletions({
			model: "openai/gpt-5.6-terra",
			messages: conversation,
			stream: false,
		});

		expect(lastBody().messages[0].content).toBe("Be terse.");
		expect(lastBody().messages[3].content).toBe("Second question");
	});

	it("stops the cached prefix before the system-reminder tail", () => {
		// What the flow layer actually sends mid-run: the conversation, the tool
		// round-trips appended to it, and the volatile tail past the end.
		const marked = withCacheBreakpoints([
			{ role: "system", content: "Be terse." },
			{ role: "user", content: "Second question" },
			{ role: "assistant", content: null, tool_calls: [] },
			{ role: "tool", content: "tool output", tool_call_id: "call_1" },
			{
				role: "user",
				content: `<system-reminder>\n## CURRENT DATE & TIME\n</system-reminder>`,
			},
		]);

		// The breakpoint sits on the last tool result, not on the reminder after
		// it. Marking the reminder would write an entry keyed on a timestamp that
		// no later request can ever match.
		expect(marked[3].content).toEqual([
			{
				type: "text",
				text: "tool output",
				cache_control: { type: "ephemeral" },
			},
		]);
		expect(marked[4].content).toBe(
			`<system-reminder>\n## CURRENT DATE & TIME\n</system-reminder>`,
		);
	});

	it("keeps the cached prefix byte-identical as the reminder changes", () => {
		const prefix = [
			{ role: "system", content: "Be terse." },
			{ role: "user", content: "Second question" },
			{ role: "tool", content: "tool output", tool_call_id: "call_1" },
		];
		const at = (time: string) => [
			...prefix,
			{
				role: "user",
				content: `<system-reminder>\nNow: ${time}\n</system-reminder>`,
			},
		];

		const first = withCacheBreakpoints(at("14:32:07"));
		const second = withCacheBreakpoints(at("14:39:51"));

		// This is the whole invariant: a different clock moves nothing the next
		// request reads through, so everything up to the breakpoint still matches.
		expect(first.slice(0, -1)).toEqual(second.slice(0, -1));
		expect(first.at(-1)).not.toEqual(second.at(-1));
	});

	it("marks the end of the conversation when the run has no reminders", () => {
		const marked = withCacheBreakpoints([
			{ role: "system", content: "Be terse." },
			{ role: "user", content: "Second question" },
			{ role: "tool", content: "tool output", tool_call_id: "call_1" },
		]);

		expect(marked[2].content).toEqual([
			{
				type: "text",
				text: "tool output",
				cache_control: { type: "ephemeral" },
			},
		]);
	});

	/**
	 * OpenRouter serves a model like DeepSeek from several upstream providers,
	 * and each keeps its own prompt cache. A conversation whose requests land on
	 * different providers can only ever reuse the request that same provider
	 * served last — so an append-only prompt still misses.
	 *
	 * That is what a real 18-request agent turn showed: every request was
	 * explained by four isolated caches, and 168k tokens were read cold. Keyed
	 * off `prompt_cache_key`, OpenRouter only starts pinning *after* the first
	 * cache hit, so the opening requests scatter before anything sticks. A
	 * `session_id` pins from the first successful request.
	 */
	describe("OpenRouter provider stickiness", () => {
		const conversationKey = "memorall:conversation:c-42";

		it("pins a conversation to one provider with session_id", async () => {
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

			await llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: conversation,
				stream: false,
				prompt_cache_key: conversationKey,
			});

			expect(lastBody().session_id).toBe(conversationKey);
		});

		it("keeps the same session for every request in a conversation", async () => {
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");
			const sessions: string[] = [];

			// An agent loop: the conversation grows, the session must not change.
			let history = [...conversation];
			for (let step = 0; step < 4; step++) {
				await llm.chatCompletions({
					model: "deepseek/deepseek-v4.1",
					messages: history,
					stream: false,
					prompt_cache_key: conversationKey,
				});
				sessions.push(lastBody().session_id);
				history = [
					...history,
					{ role: "assistant" as const, content: `step ${step}` },
					{ role: "user" as const, content: `continue ${step}` },
				];
			}

			expect(new Set(sessions)).toEqual(new Set([conversationKey]));
		});

		it("gives different conversations different sessions", async () => {
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

			await llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: conversation,
				stream: false,
				prompt_cache_key: "memorall:conversation:a",
			});
			const first = lastBody().session_id;
			await llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: conversation,
				stream: false,
				prompt_cache_key: "memorall:conversation:b",
			});

			expect(lastBody().session_id).not.toBe(first);
		});

		it("still pins a request that arrives without a conversation key", async () => {
			// Falls back to the same stable key as prompt_cache_key, which hashes
			// the first user message — identical on every turn of one thread.
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

			await llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: conversation,
				stream: false,
			});
			const first = lastBody().session_id;
			await llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: [
					...conversation,
					{ role: "assistant" as const, content: "Second answer" },
					{ role: "user" as const, content: "Third question" },
				],
				stream: false,
			});

			expect(first).toMatch(/^memorall:/);
			expect(lastBody().session_id).toBe(first);
			expect(lastBody().session_id).toBe(lastBody().prompt_cache_key);
		});

		it("pins streamed requests too", async () => {
			// The agent loop streams, so this is the path that actually matters.
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

			for await (const _ of llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: conversation,
				stream: true,
				prompt_cache_key: conversationKey,
			})) {
				// drain
			}

			expect(lastBody().session_id).toBe(conversationKey);
		});

		it("does not send session_id to a provider that does not define it", async () => {
			// OpenAI routes nothing and validates its request body; an unknown
			// field there is a failed request, not a harmless extra.
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://api.openai.com/v1");

			await llm.chatCompletions({
				model: "gpt-5.6-terra",
				messages: conversation,
				stream: false,
				prompt_cache_key: conversationKey,
			});

			expect(lastBody()).not.toHaveProperty("session_id");
		});

		it("keeps session_id within OpenRouter's 256-character limit", async () => {
			const { lastBody } = captureBody(openAIUsage);
			const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

			await llm.chatCompletions({
				model: "deepseek/deepseek-v4.1",
				messages: conversation,
				stream: false,
				prompt_cache_key: `memorall:conversation:${"x".repeat(400)}`,
			});

			expect(lastBody().session_id.length).toBeLessThanOrEqual(256);
		});
	});

	it("marks the last text part when the user message carries an image", () => {
		const marked = withCacheBreakpoints([
			{
				role: "user",
				content: [
					{ type: "text", text: "What is this?" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,x" } },
				],
			},
		]);

		expect(marked[0].content).toEqual([
			{
				type: "text",
				text: "What is this?",
				cache_control: { type: "ephemeral" },
			},
			{ type: "image_url", image_url: { url: "data:image/png;base64,x" } },
		]);
	});

	it("keeps OpenAI cached-token accounting on completions and streams", async () => {
		captureBody(openAIUsage);
		const llm = new OpenAILLM("key", "https://api.openai.com/v1");

		const completion = await llm.chatCompletions({
			model: "gpt-5.6-terra",
			messages: conversation,
			stream: false,
		});
		expect(completion.usage).toEqual({
			prompt_tokens: 1200,
			completion_tokens: 20,
			total_tokens: 1220,
			cached_tokens: 1024,
			reasoning_tokens: 5,
		});

		const chunks = [];
		for await (const chunk of llm.chatCompletions({
			model: "gpt-5.6-terra",
			messages: conversation,
			stream: true,
		})) {
			chunks.push(chunk);
		}
		const usageChunk = chunks.find((chunk) => chunk.usage);
		expect(usageChunk?.usage).toMatchObject({
			prompt_tokens: 1200,
			cached_tokens: 1024,
		});
		// The synthetic [DONE] chunk must not overwrite the provider's numbers
		// with a local estimate.
		expect(chunks.at(-1)?.usage).toBeUndefined();
	});

	it("keeps OpenRouter cache writes and cost", async () => {
		captureBody({
			prompt_tokens: 10339,
			completion_tokens: 40,
			total_tokens: 10379,
			prompt_tokens_details: { cached_tokens: 10318, cache_write_tokens: 21 },
			cost: 0.0123,
		});
		const llm = new OpenAILLM("key", "https://openrouter.ai/api/v1");

		const completion = await llm.chatCompletions({
			model: "anthropic/claude-sonnet-4.5",
			messages: conversation,
			stream: false,
		});

		expect(completion.usage).toEqual({
			prompt_tokens: 10339,
			completion_tokens: 40,
			total_tokens: 10379,
			cached_tokens: 10318,
			cache_write_tokens: 21,
			cost: 0.0123,
		});
	});
});
