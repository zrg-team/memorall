import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalOpenAICompatibleLLM } from "../local-openai-llm";
import { OpenAILLM } from "../openai-llm";

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
