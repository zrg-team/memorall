import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	closeRealtimeSession,
	createThinkEndStripper,
	encodeWav,
	respondRealtime,
	speechCategoriesOf,
	synthesizeSpeech,
	transcribeAudio,
	voicesOf,
} from "../../../../../public/runner/modes/wllama/speech.js";

const decode = vi.hoisted(() => ({
	result: { pcm: new Float32Array(16_000), sampleRate: 16_000, duration: 1 },
}));

vi.mock("../../../../../public/runner/modes/media/audio-decode.js", () => ({
	decodeAudioToMono: vi.fn(async () => decode.result),
}));

const omni = {
	has_chat: true,
	has_audio_input: true,
	has_audio_output: true,
	has_audio_stream: true,
	has_live_asr: false,
	audio_input_rate: 16_000,
	audio_output_rate: 24_000,
	audio_voices: ["female", "male"],
};

type Event = { type: string; [key: string]: unknown };

class FakeSession {
	sent: Event[] = [];
	appended: Float32Array[] = [];
	closed = false;
	/** Events per `events()` reader, one batch for each turn. */
	batches: Event[][] = [];

	async send(event: Event) {
		this.sent.push(event);
	}
	async appendAudio(samples: Float32Array) {
		this.appended.push(samples);
	}
	async *events() {
		for (const event of this.batches.shift() ?? []) yield event;
	}
	async close() {
		this.closed = true;
	}
}

const done = (status = "completed", details?: unknown) => ({
	type: "response.done",
	response: { status, status_details: details },
});

function fakeWllama(
	info: Record<string, unknown>,
	session = new FakeSession(),
) {
	return {
		session,
		getLoadedContextInfo: () => info,
		createRealtimeSession: vi.fn(async () => session),
		createSpeech: vi.fn(),
		createTranscription: vi.fn(),
	};
}

const turn = { session: "s1", audio: new ArrayBuffer(8) };
const signal = () => new AbortController().signal;

describe("speech categories come from the model's own report", () => {
	it("gives an omni model every speech task", () => {
		expect(speechCategoriesOf(omni)).toEqual([
			"text-to-speech",
			"speech-to-text",
			"speech-to-speech",
		]);
	});

	it("gives a chat model with audio input transcription only", () => {
		expect(
			speechCategoriesOf({ has_chat: true, has_audio_input: true }),
		).toEqual(["speech-to-text"]);
	});

	it("gives a speech-only model no conversation", () => {
		expect(
			speechCategoriesOf({
				has_chat: false,
				has_audio_input: true,
				has_audio_output: true,
			}),
		).toEqual(["text-to-speech"]);
	});

	it("accepts a live-transcription model that cannot chat", () => {
		expect(
			speechCategoriesOf({
				has_chat: false,
				has_audio_input: true,
				has_audio_stream: true,
				has_live_asr: true,
			}),
		).toEqual(["speech-to-text"]);
	});

	it("gives a plain chat model nothing", () => {
		expect(speechCategoriesOf({ n_ctx: 4096 })).toEqual([]);
		expect(speechCategoriesOf(undefined)).toEqual([]);
	});

	it("names voices after what the model lists", () => {
		expect(voicesOf(omni)).toEqual([
			{ id: "female", name: "female" },
			{ id: "male", name: "male" },
		]);
		expect(voicesOf({})).toEqual([]);
	});
});

describe("createThinkEndStripper", () => {
	it("removes the tag when it arrives whole", () => {
		const strip = createThinkEndStripper();
		expect(strip("</think>Hello")).toBe("Hello");
		expect(strip(" world")).toBe(" world");
	});

	it("removes the tag when it arrives in pieces", () => {
		const strip = createThinkEndStripper();
		expect(strip("</th")).toBe("");
		expect(strip("ink>")).toBe("");
		expect(strip(" Hi")).toBe(" Hi");
	});

	it("leaves ordinary text alone", () => {
		const strip = createThinkEndStripper();
		expect(strip("<")).toBe("");
		expect(strip("bold>x")).toBe("<bold>x");
		expect(strip("Hello")).toBe("Hello");
	});
});

describe("encodeWav", () => {
	it("writes a 16-bit mono header at the given rate", () => {
		const view = new DataView(encodeWav(new Float32Array([1, -1]), 24_000));
		expect(view.byteLength).toBe(48);
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(24_000);
		expect(view.getInt16(44, true)).toBe(32767);
		expect(view.getInt16(46, true)).toBe(-32768);
	});
});

describe("synthesizeSpeech", () => {
	const audio = (values: number[]) => new Float32Array(values).buffer;
	const streamOf = (chunks: unknown[]) =>
		(async function* () {
			yield* chunks;
		})();

	it("streams float PCM and reports the model's rate", async () => {
		const wllama = fakeWllama(omni);
		wllama.createSpeech.mockResolvedValue(
			streamOf([
				{ audio: audio([0.1, 0.2]), sample_rate: 24_000, final: false },
				{ audio: audio([]), sample_rate: 24_000, final: true },
			]),
		);
		const onAudio = vi.fn();
		await expect(
			synthesizeSpeech(
				wllama,
				{ input: "hi", voice: "male" },
				signal(),
				onAudio,
			),
		).resolves.toEqual({ sampleRate: 24_000 });
		expect(onAudio).toHaveBeenCalledTimes(1);
		expect(wllama.createSpeech.mock.calls[0][0]).toMatchObject({
			input: "hi",
			voice: "male",
			response_format: "pcm",
			stream: true,
		});
	});

	it("falls back to the model's first voice for a name it does not list", async () => {
		const wllama = fakeWllama(omni);
		wllama.createSpeech.mockResolvedValue(streamOf([]));
		await synthesizeSpeech(
			wllama,
			{ input: "hi", voice: "default" },
			signal(),
			vi.fn(),
		);
		expect(wllama.createSpeech.mock.calls[0][0].voice).toBe("female");
	});

	it("sends no voice to a model without any", async () => {
		const wllama = fakeWllama({ ...omni, audio_voices: [] });
		wllama.createSpeech.mockResolvedValue(streamOf([]));
		await synthesizeSpeech(
			wllama,
			{ input: "hi", voice: "default" },
			signal(),
			vi.fn(),
		);
		expect(wllama.createSpeech.mock.calls[0][0]).not.toHaveProperty("voice");
	});

	it("refuses a model with no audio output", async () => {
		const wllama = fakeWllama({ has_chat: true });
		await expect(
			synthesizeSpeech(wllama, { input: "hi" }, signal(), vi.fn()),
		).rejects.toThrow("cannot generate speech");
	});
});

describe("transcribeAudio", () => {
	it("hands a chat model a WAV and prefers its final, cleaned text", async () => {
		const wllama = fakeWllama(omni);
		wllama.createTranscription.mockResolvedValue(
			(async function* () {
				yield { type: "transcript.text.delta", delta: "</think>Hel" };
				yield { type: "transcript.text.delta", delta: "lo" };
				yield { type: "transcript.text.done", text: " Hello. " };
			})(),
		);
		const deltas: string[] = [];
		const result = await transcribeAudio(
			wllama,
			{ audio: new ArrayBuffer(8), language: "en" },
			signal(),
			(delta: string) => deltas.push(delta),
		);
		expect(deltas).toEqual(["Hel", "lo"]);
		expect(result).toEqual({ text: "Hello.", language: "en", duration: 1 });
		const call = wllama.createTranscription.mock.calls[0][0];
		expect(new TextDecoder().decode(call.file.slice(0, 4))).toBe("RIFF");
		expect(call.language).toBe("en");
	});

	it("sends a live-transcription model through a session and ends it", async () => {
		const info = {
			has_chat: false,
			has_audio_input: true,
			has_audio_stream: true,
			has_live_asr: true,
			audio_input_rate: 16_000,
		};
		const wllama = fakeWllama(info);
		wllama.session.batches = [
			[
				{
					type: "conversation.item.input_audio_transcription.delta",
					delta: "live ",
				},
				{
					type: "conversation.item.input_audio_transcription.delta",
					delta: "text",
				},
			],
		];
		const result = await transcribeAudio(
			wllama,
			{ audio: new ArrayBuffer(8) },
			signal(),
			vi.fn(),
		);
		expect(result.text).toBe("live text");
		expect(wllama.createRealtimeSession).toHaveBeenCalledWith({
			intent: "transcription",
		});
		expect(wllama.session.sent).toContainEqual({
			type: "input_audio_buffer.commit",
			final: true,
		});
		expect(wllama.session.closed).toBe(true);
		expect(wllama.createTranscription).not.toHaveBeenCalled();
	});

	it("refuses a model with no audio input", async () => {
		const wllama = fakeWllama({ has_chat: true });
		await expect(
			transcribeAudio(wllama, { audio: new ArrayBuffer(8) }, signal(), vi.fn()),
		).rejects.toThrow("cannot transcribe");
	});
});

describe("respondRealtime", () => {
	let wllama: ReturnType<typeof fakeWllama>;

	beforeEach(() => {
		wllama = fakeWllama(omni);
	});

	it("runs a turn in the order the protocol needs and streams the reply", async () => {
		wllama.session.batches = [
			[
				{ type: "response.created" },
				{ type: "response.output_text.delta", delta: "Paris" },
				{ type: "response.output_audio.delta", delta: "QUJD" },
				done(),
			],
		];
		const events: unknown[] = [];
		const result = await respondRealtime(
			wllama,
			turn,
			signal(),
			(event: unknown) => events.push(event),
		);
		expect(result).toEqual({ text: "Paris", sampleRate: 24_000 });
		expect(events).toEqual([
			{ type: "text", delta: "Paris" },
			{ type: "audio", delta: "QUJD", sampleRate: 24_000 },
		]);
		expect(wllama.session.sent.map((event) => event.type)).toEqual([
			"session.update",
			"input_audio_buffer.commit",
			"response.create",
		]);
		expect(wllama.session.appended.length).toBeGreaterThan(1);
		expect(wllama.session.closed).toBe(false);
	});

	it("keeps one session across turns, so the model remembers", async () => {
		wllama.session.batches = [[done()], [done()]];
		await respondRealtime(wllama, turn, signal(), vi.fn());
		await respondRealtime(wllama, turn, signal(), vi.fn());
		expect(wllama.createRealtimeSession).toHaveBeenCalledTimes(1);
		const updates = wllama.session.sent.filter(
			(event) => event.type === "session.update",
		);
		expect(updates).toHaveLength(1);
	});

	it("gives a different conversation its own session", async () => {
		wllama.session.batches = [[done()], [done()]];
		await respondRealtime(wllama, turn, signal(), vi.fn());
		await respondRealtime(
			wllama,
			{ ...turn, session: "s2" },
			signal(),
			vi.fn(),
		);
		expect(wllama.createRealtimeSession).toHaveBeenCalledTimes(2);
	});

	it("asks the model to stop, and keeps the session for the next turn", async () => {
		const controller = new AbortController();
		wllama.session.batches = [
			[{ type: "response.created" }, done("cancelled")],
			[done()],
		];
		const originalEvents = wllama.session.events.bind(wllama.session);
		wllama.session.events = async function* () {
			for await (const event of originalEvents()) {
				if (event.type === "response.created") controller.abort();
				yield event;
			}
		};
		await expect(
			respondRealtime(wllama, turn, controller.signal, vi.fn()),
		).rejects.toThrow("Operation aborted");
		expect(wllama.session.sent).toContainEqual({ type: "response.cancel" });
		expect(wllama.session.closed).toBe(false);

		await respondRealtime(wllama, turn, signal(), vi.fn());
		expect(wllama.createRealtimeSession).toHaveBeenCalledTimes(1);
	});

	it("clears partly sent audio when stopped before the response starts", async () => {
		const controller = new AbortController();
		const append = wllama.session.appendAudio.bind(wllama.session);
		wllama.session.appendAudio = async (samples: Float32Array) => {
			await append(samples);
			controller.abort();
		};
		await expect(
			respondRealtime(wllama, turn, controller.signal, vi.fn()),
		).rejects.toThrow("Operation aborted");
		expect(wllama.session.sent).toContainEqual({
			type: "input_audio_buffer.clear",
		});
		expect(
			wllama.session.sent.some((event) => event.type === "response.create"),
		).toBe(false);
	});

	it("discards a session that reported an error", async () => {
		wllama.session.batches = [
			[{ type: "error", error: { message: "context is full" } }],
		];
		await expect(
			respondRealtime(wllama, turn, signal(), vi.fn()),
		).rejects.toThrow("context is full");
		expect(wllama.session.closed).toBe(true);

		wllama.session.batches = [[done()]];
		await respondRealtime(wllama, turn, signal(), vi.fn());
		expect(wllama.createRealtimeSession).toHaveBeenCalledTimes(2);
	});

	it("reports a failed response with the model's reason", async () => {
		wllama.session.batches = [
			[done("failed", { error: { message: "out of memory" } })],
		];
		await expect(
			respondRealtime(wllama, turn, signal(), vi.fn()),
		).rejects.toThrow("out of memory");
	});

	it("fails clearly when the session ends mid-response", async () => {
		wllama.session.batches = [[{ type: "response.created" }]];
		await expect(
			respondRealtime(wllama, turn, signal(), vi.fn()),
		).rejects.toThrow("ended before the response finished");
	});

	it("refuses a model that cannot converse", async () => {
		const textOnly = fakeWllama({ has_chat: true, has_audio_input: true });
		await expect(
			respondRealtime(textOnly, turn, signal(), vi.fn()),
		).rejects.toThrow("cannot hold a spoken conversation");
		expect(textOnly.createRealtimeSession).not.toHaveBeenCalled();
	});
});

describe("closeRealtimeSession", () => {
	it("ends the session and forgets it", async () => {
		const wllama = fakeWllama(omni);
		wllama.session.batches = [[done()]];
		await respondRealtime(wllama, turn, signal(), vi.fn());
		await closeRealtimeSession(wllama, "s1");
		expect(wllama.session.closed).toBe(true);
		await expect(closeRealtimeSession(wllama, "s1")).resolves.toBeUndefined();
	});

	it("tolerates a model that is already gone", async () => {
		await expect(closeRealtimeSession(null, "s1")).resolves.toBeUndefined();
	});
});
