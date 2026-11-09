// Speech operations for the wllama runner.
//
// Everything here is decided by what the loaded model reports about itself
// (`getLoadedContextInfo()`), so any GGUF with an audio projector works and no
// model is known by name.

import { decodeAudioToMono } from "../media/audio-decode.js";

const FALLBACK_INPUT_RATE = 16_000;
const APPEND_SECONDS = 0.5;
const ABORTED_MESSAGE = "Operation aborted";
const THINK_END_TAG = "</think>";

const REALTIME_SESSION_DEFAULTS = {
	instructions: "Respond with interleaved text and audio.",
	max_output_tokens: 1024,
};

const throwIfAborted = (signal) => {
	if (signal?.aborted) throw new Error(ABORTED_MESSAGE);
};

const canChat = (info) => info?.has_chat !== false;

/**
 * The speech tasks a loaded model can do.
 * @param {object|undefined} info `getLoadedContextInfo()`
 * @returns {string[]}
 */
export function speechCategoriesOf(info) {
	if (!info) return [];
	const categories = [];
	if (info.has_audio_output) categories.push("text-to-speech");
	if ((canChat(info) && info.has_audio_input) || info.has_audio_stream) {
		categories.push("speech-to-text");
	}
	if (canChat(info) && info.has_audio_stream && info.has_audio_output) {
		categories.push("speech-to-speech");
	}
	return categories;
}

/** @param {object|undefined} info `getLoadedContextInfo()` */
export function voicesOf(info) {
	return (info?.audio_voices ?? []).map((id) => ({ id, name: id }));
}

/** 16-bit mono WAV, a container every model's audio loader can read. */
export function encodeWav(samples, sampleRate) {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const writeAscii = (offset, text) => {
		for (let index = 0; index < text.length; index++) {
			view.setUint8(offset + index, text.charCodeAt(index));
		}
	};
	writeAscii(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	writeAscii(8, "WAVE");
	writeAscii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeAscii(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let index = 0; index < samples.length; index++) {
		const clamped = Math.max(-1, Math.min(1, samples[index]));
		view.setInt16(
			44 + index * 2,
			clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
			true,
		);
	}
	return buffer;
}

/**
 * Some models open their transcript with a stray reasoning close tag. The final
 * text arrives clean, so only the live deltas need it removed.
 * @returns {(delta: string) => string}
 */
export function createThinkEndStripper() {
	let pending = "";
	let settled = false;
	return (delta) => {
		if (settled) return delta;
		pending += delta;
		if (pending.length < THINK_END_TAG.length && THINK_END_TAG.startsWith(pending)) {
			return "";
		}
		settled = true;
		const text = pending.startsWith(THINK_END_TAG)
			? pending.slice(THINK_END_TAG.length).trimStart()
			: pending;
		pending = "";
		return text;
	};
}

async function appendAudio(session, samples, sampleRate) {
	const size = Math.max(1, Math.round(sampleRate * APPEND_SECONDS));
	for (let offset = 0; offset < samples.length; offset += size) {
		await session.appendAudio(samples.subarray(offset, offset + size));
	}
}

/**
 * @param {any} wllama
 * @param {{ input: string, voice?: string, language?: string, seed?: number }} request
 * @param {AbortSignal} signal
 * @param {(pcm: Float32Array, sampleRate: number) => void} onAudio
 */
export async function synthesizeSpeech(wllama, request, signal, onAudio) {
	const info = wllama.getLoadedContextInfo();
	if (!info.has_audio_output) {
		throw new Error("This model cannot generate speech.");
	}
	const voices = info.audio_voices ?? [];
	const voice = voices.includes(request.voice) ? request.voice : voices[0];
	const stream = await wllama.createSpeech({
		input: request.input,
		...(voice ? { voice } : {}),
		...(request.language ? { lang: request.language } : {}),
		...(request.seed !== undefined ? { seed: request.seed } : {}),
		response_format: "pcm",
		stream: true,
		abortSignal: signal,
	});
	let sampleRate = info.audio_output_rate;
	for await (const chunk of stream) {
		sampleRate = chunk.sample_rate;
		const pcm = new Float32Array(chunk.audio);
		if (pcm.length > 0) onAudio(pcm, sampleRate);
	}
	return { sampleRate };
}

async function transcribeWithSession(wllama, info, samples, signal, onDelta) {
	const session = await wllama.createRealtimeSession(
		info.has_live_asr ? { intent: "transcription" } : {},
	);
	try {
		if (!info.has_live_asr) {
			await session.send({
				type: "session.update",
				session: { type: "transcription" },
			});
		}
		await appendAudio(session, samples, info.audio_input_rate);
		// A final commit ends a live session, and its last text follows.
		await session.send({
			type: "input_audio_buffer.commit",
			...(info.has_live_asr ? { final: true } : {}),
		});
		let text = "";
		for await (const event of session.events()) {
			throwIfAborted(signal);
			if (event.type === "conversation.item.input_audio_transcription.delta") {
				text += event.delta;
				onDelta(event.delta);
			} else if (
				event.type === "conversation.item.input_audio_transcription.completed" &&
				!info.has_live_asr
			) {
				break;
			} else if (event.type === "error") {
				throw new Error(event.error?.message ?? "Transcription failed");
			}
		}
		return text;
	} finally {
		await session.close().catch(() => undefined);
	}
}

/**
 * @param {any} wllama
 * @param {{ audio: ArrayBuffer, language?: string, prompt?: string, temperature?: number }} request
 * @param {AbortSignal} signal
 * @param {(delta: string) => void} onDelta
 */
export async function transcribeAudio(wllama, request, signal, onDelta) {
	const info = wllama.getLoadedContextInfo();
	const usesFileApi = canChat(info) && info.has_audio_input;
	if (!usesFileApi && !info.has_audio_stream) {
		throw new Error("This model cannot transcribe audio.");
	}
	// Browsers record webm and uploads can be anything; the model's own loader
	// only reads a few containers, so everything is decoded here first.
	const rate = info.audio_input_rate || FALLBACK_INPUT_RATE;
	const { pcm, duration } = await decodeAudioToMono(request.audio, rate);
	throwIfAborted(signal);

	if (!usesFileApi) {
		const text = await transcribeWithSession(wllama, info, pcm, signal, onDelta);
		return { text: text.trim(), language: request.language, duration };
	}

	const stream = await wllama.createTranscription({
		file: encodeWav(pcm, rate),
		...(request.language ? { language: request.language } : {}),
		...(request.prompt ? { prompt: request.prompt } : {}),
		...(request.temperature !== undefined
			? { temperature: request.temperature }
			: {}),
		stream: true,
		abortSignal: signal,
	});
	const strip = createThinkEndStripper();
	let streamed = "";
	let finalText = null;
	for await (const chunk of stream) {
		if (chunk.type === "transcript.text.delta") {
			const delta = strip(chunk.delta);
			if (delta) {
				streamed += delta;
				onDelta(delta);
			}
		} else if (chunk.type === "transcript.text.done") {
			finalText = chunk.text;
		}
	}
	return {
		text: (finalText ?? streamed).trim(),
		language: request.language,
		duration,
	};
}

/** Sessions live on the model instance, so they end when it is unloaded. */
const realtimeSessionsOf = (wllama) => {
	wllama._realtimeSessions ??= new Map();
	return wllama._realtimeSessions;
};

async function openRealtimeSession(wllama, request) {
	const sessions = realtimeSessionsOf(wllama);
	const existing = sessions.get(request.session);
	if (existing) return existing;
	const session = await wllama.createRealtimeSession();
	await session.send({
		type: "session.update",
		session: {
			instructions:
				request.instructions ?? REALTIME_SESSION_DEFAULTS.instructions,
			output_modalities: ["audio", "text"],
			max_output_tokens:
				request.max_output_tokens ?? REALTIME_SESSION_DEFAULTS.max_output_tokens,
		},
	});
	sessions.set(request.session, session);
	return session;
}

/**
 * End one realtime session. The model may already be gone, which ended it.
 * @param {any} wllama
 * @param {string} sessionId
 */
export async function closeRealtimeSession(wllama, sessionId) {
	const sessions = wllama?._realtimeSessions;
	const session = sessions?.get(sessionId);
	if (!session) return;
	sessions.delete(sessionId);
	await session.close().catch(() => undefined);
}

/**
 * One spoken turn: the user's audio in, the model's text and speech out. The
 * session stays open between turns so the model remembers the conversation.
 *
 * @param {any} wllama
 * @param {{ session: string, audio: ArrayBuffer, instructions?: string, max_output_tokens?: number }} request
 * @param {AbortSignal} signal
 * @param {(event: { type: "text", delta: string } | { type: "audio", delta: string, sampleRate: number }) => void} emit
 */
export async function respondRealtime(wllama, request, signal, emit) {
	const info = wllama.getLoadedContextInfo();
	if (!speechCategoriesOf(info).includes("speech-to-speech")) {
		throw new Error("This model cannot hold a spoken conversation.");
	}
	const { pcm } = await decodeAudioToMono(
		request.audio,
		info.audio_input_rate,
	);
	throwIfAborted(signal);

	const session = await openRealtimeSession(wllama, request);
	const requestCancel = () => {
		session.send({ type: "response.cancel" }).catch(() => undefined);
	};
	let responding = false;
	try {
		await appendAudio(session, pcm, info.audio_input_rate);
		throwIfAborted(signal);
		await session.send({ type: "input_audio_buffer.commit" });
		await session.send({ type: "response.create" });
		responding = true;
		signal.addEventListener("abort", requestCancel, { once: true });
		if (signal.aborted) requestCancel();

		let text = "";
		// Inference runs while events are read. A reader that leaves early hands
		// the rest to the next turn, so the session outlives this loop.
		for await (const event of session.events()) {
			if (event.type === "response.output_text.delta") {
				text += event.delta;
				emit({ type: "text", delta: event.delta });
			} else if (event.type === "response.output_audio.delta") {
				emit({
					type: "audio",
					delta: event.delta,
					sampleRate: info.audio_output_rate,
				});
			} else if (event.type === "error") {
				throw new Error(event.error?.message ?? "The response failed");
			} else if (event.type === "response.done") {
				const { status, status_details: details } = event.response ?? {};
				if (status === "cancelled") throw new Error(ABORTED_MESSAGE);
				if (status === "failed") {
					throw new Error(details?.error?.message ?? "The response failed");
				}
				return { text, sampleRate: info.audio_output_rate };
			}
		}
		throw new Error("The realtime session ended before the response finished");
	} catch (error) {
		if (error?.message === ABORTED_MESSAGE) {
			// Audio appended before the stop must not leak into the next turn.
			if (!responding) {
				await session
					.send({ type: "input_audio_buffer.clear" })
					.catch(() => undefined);
			}
			throw error;
		}
		// A session that hit an error cannot be trusted; the next turn gets a new one.
		await closeRealtimeSession(wllama, request.session);
		throw error;
	} finally {
		signal.removeEventListener("abort", requestCancel);
	}
}
