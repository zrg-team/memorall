import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	ImageGenerationStreamEvent,
	SpeechStreamEvent,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import { bytesToBase64, float32ToPcm16 } from "../utils/media-encoding";
import {
	createSpeech,
	createTranscription,
	generateImages,
	streamSpeech,
	streamTranscription,
	type OpenAIMediaTransport,
} from "../utils/openai-media-client";

const transport = (isOpenRouter = false): OpenAIMediaTransport => ({
	baseURL: "https://api.test/v1",
	headers: () => ({ Authorization: "Bearer key" }),
	isOpenRouter,
});

const sse = (events: unknown[]) =>
	new Response(
		new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				for (const event of events) {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
					);
				}
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				controller.close();
			},
		}),
		{ headers: { "content-type": "text/event-stream" } },
	);

const rejected = () => new Response("unsupported parameter", { status: 400 });

const collect = async <T>(iterator: AsyncIterableIterator<T>) => {
	const items: T[] = [];
	for await (const item of iterator) items.push(item);
	return items;
};

const bodyOf = (call: unknown[] | undefined) =>
	JSON.parse(String((call?.[1] as RequestInit | undefined)?.body));

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("speech", () => {
	it("posts /audio/speech and returns the audio bytes", async () => {
		fetchMock.mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				headers: { "content-type": "audio/wav" },
			}),
		);

		const result = await createSpeech(transport(), {
			model: "any-model",
			input: "hello",
			voice: "any-voice",
		});

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://api.test/v1/audio/speech",
		);
		expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({
			model: "any-model",
			input: "hello",
			voice: "any-voice",
			response_format: "wav",
		});
		expect(result.audio).toEqual({
			kind: "bytes",
			bytes: new Uint8Array([1, 2, 3]),
			mimeType: "audio/wav",
		});
	});

	it("streams SSE PCM deltas and assembles a WAV", async () => {
		const pcm = bytesToBase64(float32ToPcm16(new Float32Array(2400)));
		fetchMock.mockResolvedValue(
			sse([
				{ type: "speech.audio.delta", audio: pcm },
				{ type: "speech.audio.delta", audio: pcm },
				{ type: "speech.audio.done" },
			]),
		);

		const events = await collect<SpeechStreamEvent>(
			streamSpeech(transport(), {
				model: "any-model",
				input: "hello",
				voice: "v",
			}),
		);

		expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({
			stream_format: "sse",
			response_format: "pcm",
		});
		expect(
			events.filter((event) => event.type === "speech.audio.delta"),
		).toHaveLength(2);
		const done = events.at(-1);
		expect(done?.type).toBe("speech.audio.done");
		if (done?.type === "speech.audio.done") {
			expect(done.result.duration_ms).toBe(200);
			expect(done.result.audio.mimeType).toBe("audio/wav");
		}
	});

	it("falls back to one file when the server rejects streaming", async () => {
		fetchMock
			.mockResolvedValueOnce(rejected())
			.mockResolvedValueOnce(new Response(new Uint8Array(10)));

		const events = await collect(
			streamSpeech(transport(), { model: "any-model", input: "x", voice: "v" }),
		);

		expect(events.map((event) => event.type)).toEqual(["speech.audio.done"]);
		expect(bodyOf(fetchMock.mock.calls[1])).not.toHaveProperty("stream_format");
	});

	it("reads raw PCM when the server ignores the stream format", async () => {
		fetchMock.mockResolvedValue(
			new Response(float32ToPcm16(new Float32Array(4800)).slice().buffer, {
				headers: { "content-type": "application/octet-stream" },
			}),
		);

		const [done] = await collect<SpeechStreamEvent>(
			streamSpeech(transport(), { model: "any-model", input: "x", voice: "v" }),
		);

		expect(done?.type === "speech.audio.done" && done.result.duration_ms).toBe(
			200,
		);
	});
});

describe("transcription", () => {
	it("uploads multipart audio and reads verbose segments", async () => {
		fetchMock.mockResolvedValue(
			Response.json({
				text: " Hello there. ",
				language: "english",
				duration: 1.5,
				segments: [{ id: 0, start: 0, end: 1.5, text: " Hello there." }],
			}),
		);

		const result = await createTranscription(transport(), {
			model: "any-model",
			file: {
				kind: "base64",
				data: bytesToBase64(new Uint8Array(8)),
				mimeType: "audio/webm",
			},
			language: "en",
			task: "translate",
		});

		const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
		expect(body.get("model")).toBe("any-model");
		expect(body.get("response_format")).toBe("verbose_json");
		expect(body.get("language")).toBe("en");
		expect(body.get("task")).toBe("translate");
		expect((body.get("file") as File).name).toBe("audio.webm");
		expect(result).toEqual({
			text: "Hello there.",
			language: "english",
			duration: 1.5,
			segments: [{ id: 0, start: 0, end: 1.5, text: "Hello there." }],
			words: undefined,
		});
	});

	it("asks again for plain JSON when verbose output is rejected", async () => {
		fetchMock
			.mockResolvedValueOnce(rejected())
			.mockResolvedValueOnce(Response.json({ text: "hi" }));

		const result = await createTranscription(transport(), {
			model: "any-model",
			file: { kind: "base64", data: "", mimeType: "audio/wav" },
		});

		expect(
			(fetchMock.mock.calls[1]?.[1]?.body as FormData).get("response_format"),
		).toBe("json");
		expect(result.text).toBe("hi");
	});

	it("streams SSE deltas when the server streams", async () => {
		fetchMock.mockResolvedValue(
			sse([
				{ type: "transcript.text.delta", delta: "Hel" },
				{ type: "transcript.text.delta", delta: "lo" },
				{ type: "transcript.text.done", text: "Hello" },
			]),
		);

		const events = await collect<TranscriptionStreamEvent>(
			streamTranscription(transport(), {
				model: "any-model",
				file: { kind: "base64", data: "", mimeType: "audio/wav" },
			}),
		);

		expect(events).toEqual([
			{ type: "transcript.text.delta", delta: "Hel" },
			{ type: "transcript.text.delta", delta: "lo" },
			{ type: "transcript.text.done", result: { text: "Hello" } },
		]);
	});

	it("accepts a finished JSON transcript when streaming is ignored", async () => {
		fetchMock.mockResolvedValue(Response.json({ text: "whole" }));
		const events = await collect<TranscriptionStreamEvent>(
			streamTranscription(transport(), {
				model: "any-model",
				file: { kind: "base64", data: "", mimeType: "audio/wav" },
			}),
		);
		expect(events).toEqual([
			{
				type: "transcript.text.done",
				result: {
					text: "whole",
					language: undefined,
					duration: undefined,
					segments: undefined,
					words: undefined,
				},
			},
		]);
	});
});

describe("image generation", () => {
	it("asks for base64 and retries without response_format when rejected", async () => {
		fetchMock
			.mockResolvedValueOnce(rejected())
			.mockResolvedValueOnce(
				Response.json({ created: 1, data: [{ b64_json: "AAAA" }] }),
			);

		const events = await collect<ImageGenerationStreamEvent>(
			generateImages(transport(), { model: "any-model", prompt: "a cat" }),
		);

		expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({
			response_format: "b64_json",
		});
		expect(bodyOf(fetchMock.mock.calls[1])).not.toHaveProperty(
			"response_format",
		);
		expect(events.at(-1)).toEqual({
			type: "image_generation.completed",
			result: {
				created: 1,
				data: [
					{
						b64_json: "AAAA",
						url: undefined,
						mime_type: "image/png",
						revised_prompt: undefined,
					},
				],
			},
		});
	});

	it("edits with every image and the mask, asking for less when rejected", async () => {
		const bodies: FormData[] = [];
		fetchMock.mockImplementation(async (url, init) => {
			expect(url).toBe("https://api.test/v1/images/edits");
			const form = init?.body as FormData;
			bodies.push(form);
			// This server takes one image and no mask.
			return form.getAll("image[]").length > 0 || form.has("mask")
				? rejected()
				: Response.json({ data: [{ b64_json: "AAAA" }] });
		});

		const events = await collect<ImageGenerationStreamEvent>(
			generateImages(transport(), {
				model: "any-model",
				prompt: "make it night",
				image: [
					{ kind: "base64", data: "AAAA", mimeType: "image/png" },
					{ kind: "base64", data: "BBBB", mimeType: "image/png" },
				],
				mask: { kind: "base64", data: "CCCC", mimeType: "image/png" },
			}),
		);

		expect(bodies[0]?.getAll("image[]")).toHaveLength(2);
		expect(bodies[0]?.has("mask")).toBe(true);
		const accepted = bodies.at(-1) as FormData;
		expect(accepted.getAll("image")).toHaveLength(1);
		expect(accepted.has("mask")).toBe(false);
		expect(accepted.get("prompt")).toBe("make it night");
		expect(events.at(-1)).toMatchObject({
			type: "image_generation.completed",
			result: { data: [{ b64_json: "AAAA" }] },
		});
	});

	it("generates from the prompt when the server has no edits endpoint", async () => {
		fetchMock.mockImplementation(async (url) =>
			String(url).endsWith("/images/edits")
				? new Response("not found", { status: 404 })
				: Response.json({ data: [{ b64_json: "AAAA" }] }),
		);

		await collect<ImageGenerationStreamEvent>(
			generateImages(transport(), {
				model: "any-model",
				prompt: "make it night",
				image: [{ kind: "base64", data: "AAAA", mimeType: "image/png" }],
			}),
		);

		expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
			"https://api.test/v1/images/edits",
			"https://api.test/v1/images/generations",
		]);
	});

	it("sends images to work from as image parts to chat image models", async () => {
		fetchMock.mockResolvedValue(
			Response.json({
				choices: [
					{
						message: {
							images: [{ image_url: { url: "data:image/png;base64,AAAA" } }],
						},
					},
				],
			}),
		);

		await collect<ImageGenerationStreamEvent>(
			generateImages(transport(true), {
				model: "vendor/image-model",
				prompt: "make it night",
				image: [{ kind: "base64", data: "QUJD", mimeType: "image/png" }],
			}),
		);

		const body = bodyOf(fetchMock.mock.calls[0]);
		expect(body.messages[0].content).toEqual([
			{ type: "text", text: "make it night" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
		]);
	});

	it("uses chat modalities on providers that generate images through chat", async () => {
		fetchMock.mockResolvedValue(
			Response.json({
				choices: [
					{
						message: {
							content: "Here you go",
							images: [{ image_url: { url: "data:image/png;base64,QUJD" } }],
						},
					},
				],
			}),
		);

		const events = await collect<ImageGenerationStreamEvent>(
			generateImages(transport(true), {
				model: "vendor/any-model",
				prompt: "a cat",
			}),
		);

		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://api.test/v1/chat/completions",
		);
		expect(bodyOf(fetchMock.mock.calls[0]).modalities).toEqual([
			"image",
			"text",
		]);
		const completed = events.at(-1);
		if (completed?.type === "image_generation.completed") {
			expect(completed.result.data[0]).toMatchObject({
				b64_json: "QUJD",
				mime_type: "image/png",
			});
		} else {
			throw new Error("expected a completed event");
		}
	});

	it("reports a text-only answer as a failure", async () => {
		fetchMock.mockResolvedValue(
			Response.json({ choices: [{ message: { content: "I cannot draw" } }] }),
		);
		await expect(
			collect(generateImages(transport(true), { model: "x", prompt: "y" })),
		).rejects.toThrow("I cannot draw");
	});
});
