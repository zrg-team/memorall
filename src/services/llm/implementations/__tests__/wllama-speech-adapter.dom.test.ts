import { describe, expect, it, vi } from "vitest";
import { bytesToBase64, float32ToPcm16 } from "../../utils/media-encoding";
import { WllamaLLM } from "../wllama-llm";

const model = "org/Omni-GGUF/Omni-Q4_K_M.gguf";
const audioFile = {
	kind: "bytes" as const,
	bytes: new Uint8Array([1, 2, 3, 4]),
	mimeType: "audio/wav",
};

function adapter() {
	const llm = new WllamaLLM();
	// Access the iframe boundary without creating an actual iframe in jsdom.
	// biome-ignore lint/suspicious/noExplicitAny: test reaches private fields
	const internal = llm as any;
	internal.ready = true;
	internal.getRunnerMemoryHint = vi.fn(async () => undefined);
	internal.iframeRuntime.finishOperation = vi.fn(async () => undefined);
	const postMessage = vi.fn();
	const target = { postMessage };
	internal.iframe = { contentWindow: target };
	const reply = (messageId: string, type: string, payload: unknown) =>
		internal.onMessage({ source: target, data: { messageId, type, payload } });
	const sent = async () => {
		await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
		return postMessage.mock.calls[0][0];
	};
	return { llm, internal, postMessage, reply, sent };
}

const collect = async <T>(stream: AsyncIterable<T>) => {
	const events: T[] = [];
	for await (const event of stream) events.push(event);
	return events;
};

const pcmBase64 = (samples: number[]) =>
	bytesToBase64(float32ToPcm16(new Float32Array(samples)));

describe("wllama speech adapter", () => {
	it("turns runner PCM into speech events and one WAV", async () => {
		const { llm, reply, sent } = adapter();
		const pending = collect(
			llm.audioSpeechStream({ model, input: "hi", voice: "female" }),
		);
		const message = await sent();
		expect(message.type).toBe("audio/speech");
		reply(message.messageId, "stream_chunk", {
			pcm: new Float32Array(24_000).fill(0.5),
			sampleRate: 24_000,
		});
		reply(message.messageId, "complete", { sampleRate: 24_000 });

		const events = await pending;
		expect(events.map((event) => event.type)).toEqual([
			"speech.audio.delta",
			"speech.audio.done",
		]);
		const done = events[1];
		if (done?.type !== "speech.audio.done") throw new Error("no result");
		expect(done.result).toMatchObject({
			sample_rate: 24_000,
			duration_ms: 1000,
			voice: "female",
		});
		expect(done.result.audio).toMatchObject({ mimeType: "audio/wav" });
	});

	it("fails rather than returning an empty clip", async () => {
		const { llm, reply, sent } = adapter();
		const pending = collect(
			llm.audioSpeechStream({ model, input: "hi", voice: "x" }),
		);
		const message = await sent();
		reply(message.messageId, "complete", { sampleRate: 24_000 });
		await expect(pending).rejects.toThrow("produced no audio");
	});

	it("streams transcript deltas and sends the file's bytes", async () => {
		const { llm, reply, sent } = adapter();
		const pending = collect(
			llm.audioTranscriptionsStream({ model, file: audioFile, language: "en" }),
		);
		const message = await sent();
		expect(message.type).toBe("audio/transcriptions");
		expect(message.payload.language).toBe("en");
		expect(new Uint8Array(message.payload.audio)).toEqual(audioFile.bytes);
		expect(message.payload).not.toHaveProperty("file");
		reply(message.messageId, "stream_chunk", { delta: "Hel" });
		reply(message.messageId, "complete", { text: "Hello", duration: 1 });

		await expect(pending).resolves.toEqual([
			{ type: "transcript.text.delta", delta: "Hel" },
			{
				type: "transcript.text.done",
				result: { text: "Hello", duration: 1 },
			},
		]);
	});

	it("streams a spoken reply and assembles its audio", async () => {
		const { llm, reply, sent } = adapter();
		const pending = collect(
			llm.realtimeResponse({ model, session: "s1", audio: audioFile }),
		);
		const message = await sent();
		expect(message.type).toBe("realtime/response");
		expect(message.payload.session).toBe("s1");
		reply(message.messageId, "stream_chunk", { type: "text", delta: "Paris" });
		reply(message.messageId, "stream_chunk", {
			type: "audio",
			delta: pcmBase64(new Array(24_000).fill(0.25)),
			sampleRate: 24_000,
		});
		reply(message.messageId, "complete", { text: "Paris", sampleRate: 24_000 });

		const events = await pending;
		expect(events[0]).toEqual({
			type: "response.output_text.delta",
			delta: "Paris",
		});
		expect(events[1]).toMatchObject({
			type: "response.output_audio.delta",
			sample_rate: 24_000,
			seq: 0,
		});
		const done = events[events.length - 1];
		if (done?.type !== "response.done") throw new Error("no result");
		expect(done.result).toMatchObject({
			object: "realtime.response",
			session: "s1",
			text: "Paris",
			sample_rate: 24_000,
			duration_ms: 1000,
		});
		expect(done.result.audio).toMatchObject({ mimeType: "audio/wav" });
	});

	it("reports a text-only reply without audio", async () => {
		const { llm, reply, sent } = adapter();
		const pending = collect(
			llm.realtimeResponse({ model, session: "s1", audio: audioFile }),
		);
		const message = await sent();
		reply(message.messageId, "complete", { text: "Paris" });
		const events = await pending;
		const done = events[events.length - 1];
		if (done?.type !== "response.done") throw new Error("no result");
		expect(done.result.audio).toBeUndefined();
	});

	it("waits for the runner to finish a cancelled turn", async () => {
		const { llm, internal, postMessage, reply, sent } = adapter();
		const controller = new AbortController();
		const stream = llm.realtimeResponse({
			model,
			session: "s1",
			audio: audioFile,
			signal: controller.signal,
		});
		const settled = vi.fn();
		const outcome = collect(stream).catch((error) => {
			settled();
			return error;
		});
		const message = await sent();
		controller.abort();
		await Promise.resolve();
		expect(postMessage).toHaveBeenLastCalledWith(
			{ messageId: message.messageId, type: "abort" },
			"*",
		);
		expect(settled).not.toHaveBeenCalled();
		expect(internal.iframeRuntime.finishOperation).not.toHaveBeenCalled();

		reply(message.messageId, "error", {
			error: { message: "Operation aborted" },
		});
		await expect(outcome).resolves.toMatchObject({
			message: "Operation aborted",
		});
		expect(internal.iframeRuntime.finishOperation).toHaveBeenCalled();
	});

	it("closes a session through the runner", async () => {
		const { llm, reply, sent } = adapter();
		const pending = llm.closeRealtimeSession({ model, session: "s1" });
		const message = await sent();
		expect(message).toMatchObject({
			type: "realtime/close",
			payload: { session: "s1" },
		});
		reply(message.messageId, "complete", { closed: true });
		await expect(pending).resolves.toBeUndefined();
	});

	it("does not start a runner just to close a session", async () => {
		const { llm, internal, postMessage } = adapter();
		internal.ready = false;
		await llm.closeRealtimeSession({ model, session: "s1" });
		expect(postMessage).not.toHaveBeenCalled();
	});
});
