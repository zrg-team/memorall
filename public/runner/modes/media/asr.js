// Speech to text through the `automatic-speech-recognition` pipeline, on
// 16 kHz mono PCM decoded by the runner frame.
import {
	MediaInputError,
	OperationCancelledError,
	createInterruptCriteria,
} from "./cancellation.js";
import { runOnDevice } from "./device.js";
import { buildAsrOptions, buildSegments } from "./transcript.js";

export const ASR_SAMPLE_RATE = 16_000;

function toPcm(audio) {
	if (audio instanceof Float32Array) return audio;
	if (audio && typeof audio === "object" && audio.byteLength !== undefined) {
		return new Float32Array(audio);
	}
	throw new MediaInputError(
		"audio must be 16 kHz mono PCM decoded by the runner frame",
	);
}

/**
 * @returns {Promise<{ text: string, language?: string, duration: number, segments?: object[] }>}
 */
export async function transcribe({
	transformers,
	bundle,
	payload,
	cancellation,
	sendChunk,
}) {
	const pcm = toPcm(payload?.audio);
	const sampleRate = payload?.sampleRate ?? ASR_SAMPLE_RATE;
	if (sampleRate !== ASR_SAMPLE_RATE) {
		throw new MediaInputError(
			`audio must be resampled to ${ASR_SAMPLE_RATE} Hz (got ${sampleRate})`,
		);
	}
	const duration = Math.round((pcm.length / ASR_SAMPLE_RATE) * 100) / 100;
	if (pcm.length === 0) return { text: "", duration: 0, segments: [] };

	const pipe = bundle.pipe;
	const requested = buildAsrOptions({
		language: payload.language,
		task: payload.task,
	});
	const stopping = createInterruptCriteria(transformers, cancellation);
	const streamer =
		transformers.TextStreamer && pipe.tokenizer
			? new transformers.TextStreamer(pipe.tokenizer, {
					skip_prompt: true,
					skip_special_tokens: true,
					callback_function: (text) => {
						// Throwing ends generate() between tokens.
						if (cancellation.cancelled) throw new OperationCancelledError();
						if (text) sendChunk({ delta: text });
					},
				})
			: undefined;
	const extras = {
		...(streamer ? { streamer } : {}),
		...(stopping ? { stopping_criteria: stopping } : {}),
	};

	let output;
	try {
		output = await runOnDevice(bundle.device, () =>
			pipe(pcm, { ...requested, ...extras }),
		);
	} catch (error) {
		if (cancellation.cancelled) throw error;
		// A pipeline that rejects an option (language on an English-only model,
		// timestamps on a CTC model) still transcribes with its defaults.
		console.warn(
			"[media-runner] retrying transcription with default options",
			error,
		);
		output = await runOnDevice(bundle.device, () => pipe(pcm, extras));
	}
	cancellation.throwIfCancelled();

	const result = Array.isArray(output) ? output[0] : output;
	const transcription = {
		text: String(result?.text ?? "").trim(),
		duration,
	};
	const segments = buildSegments(result?.chunks, duration);
	if (segments.length > 0) transcription.segments = segments;
	if (requested.language) transcription.language = requested.language;
	return transcription;
}
