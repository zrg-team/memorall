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

/** The installed Whisper generator defaults to English; infer its language token explicitly. */
export async function detectWhisperLanguage(pipe, pcm, cancellation) {
	const config = pipe.model?.generation_config;
	if (!config?.is_multilingual || !config.lang_to_id) return undefined;
	const ids = new Map(
		Object.entries(config.lang_to_id).map(([token, id]) => [
			Number(id),
			token.replace(/^<\||\|>$/g, ""),
		]),
	);
	const vocabulary = pipe.model.config?.vocab_size;
	const start =
		config.decoder_start_token_id ?? pipe.model.config?.decoder_start_token_id;
	if (
		!vocabulary ||
		!Number.isInteger(start) ||
		typeof pipe.processor !== "function"
	)
		throw new MediaInputError(
			"This model cannot auto-detect language. Select the spoken language in Studio.",
		);
	cancellation.throwIfCancelled();
	const inputs = await pipe.processor(pcm);
	const suppressed = Array.from({ length: vocabulary }, (_, id) => id).filter(
		(id) => !ids.has(id),
	);
	const tokens = await pipe.model.generate({
		...inputs,
		decoder_input_ids: [start],
		max_new_tokens: 1,
		return_timestamps: false,
		return_dict_in_generate: false,
		forced_decoder_ids: null,
		forced_bos_token_id: null,
		begin_suppress_tokens: [],
		suppress_tokens: suppressed,
	});
	cancellation.throwIfCancelled();
	const language = ids.get(Number(tokens?.data?.at(-1)));
	if (!language)
		throw new MediaInputError(
			"Could not detect the speech language. Select the spoken language in Studio.",
		);
	return language;
}

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
	const englishOnly = pipe.model?.generation_config?.is_multilingual === false;
	if (englishOnly) {
		if (
			requested.language &&
			requested.language !== "en" &&
			requested.language !== "english"
		) {
			throw new MediaInputError(
				"This model supports English only. Choose a multilingual Whisper model for this language.",
			);
		}
		delete requested.language;
		delete requested.task;
	} else if (!requested.language) {
		const language = await runOnDevice(bundle.device, () =>
			detectWhisperLanguage(pipe, pcm, cancellation),
		);
		if (language) requested.language = language;
	}
	const stopping = createInterruptCriteria(transformers, cancellation);
	// Whisper timestamp tokens are not classified as special tokens.
	const Streamer =
		typeof pipe.tokenizer?.timestamp_begin === "number" &&
		transformers.WhisperTextStreamer
			? transformers.WhisperTextStreamer
			: transformers.TextStreamer;
	const streamer =
		Streamer && pipe.tokenizer
			? new Streamer(pipe.tokenizer, {
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

	// Never retry inference without its language: that silently changes multilingual
	// output to English and can repeat a failed allocation on an exhausted worker.
	const output = await runOnDevice(bundle.device, () =>
		pipe(pcm, { ...requested, ...extras }),
	);
	cancellation.throwIfCancelled();

	const result = Array.isArray(output) ? output[0] : output;
	const transcription = {
		text: String(result?.text ?? "").trim(),
		duration,
	};
	const segments = buildSegments(result?.chunks, duration);
	if (segments.length > 0) transcription.segments = segments;
	if (requested.language) transcription.language = requested.language;
	else if (englishOnly) transcription.language = "en";
	return transcription;
}
