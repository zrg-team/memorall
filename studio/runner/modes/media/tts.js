// Text to speech and text to audio through the `text-to-speech` /
// `text-to-audio` pipelines.
//
// The pipeline handles every architecture differences internally; this only
// passes the generic request options (a voice's speaker embedding, speed) and
// streams the waveform back sentence by sentence. Models that make audio token
// by token, which the pipeline runs as a single forward pass and so cannot
// serve, are run through the model's own `generate`.
import { fetchCachedArrayBuffer } from "./cache.js";
import { MediaInputError } from "./cancellation.js";
import { runOnDevice } from "./device.js";
import { splitSpeechText } from "./text-chunking.js";
import { detachableCopy } from "./transferables.js";

function audioSamples(output) {
	const audio = Array.isArray(output) ? output[0] : output;
	const samples =
		audio?.audio instanceof Float32Array ? audio.audio : audio?.data;
	if (!(samples instanceof Float32Array)) {
		throw new Error("The model returned no audio samples");
	}
	return { samples, sampleRate: audio.sampling_rate };
}

/** Seconds of generated audio when the request does not say. */
export const DEFAULT_GENERATED_SECONDS = 10;
const MAX_GENERATED_SECONDS = 60;

/** A number from the model config, or from one of its sub-configs. */
function configNumber(config, key) {
	if (!config || typeof config !== "object") return undefined;
	if (typeof config[key] === "number") return config[key];
	for (const value of Object.values(config)) {
		if (value && typeof value === "object" && typeof value[key] === "number") {
			return value[key];
		}
	}
	return undefined;
}

/**
 * Generated tokens per second of audio. Codec configs declare it directly
 * (`frame_rate`) or through how many samples one token decodes to: a
 * `hop_length`, or the product of the decoder's `upsampling_ratios`.
 */
export function audioFrameRate(config) {
	const declared = configNumber(config, "frame_rate");
	if (declared) return declared;
	const sampleRate = configNumber(config, "sampling_rate");
	if (!sampleRate) return undefined;
	const hop = configNumber(config, "hop_length");
	if (hop) return sampleRate / hop;
	for (const value of [config, ...Object.values(config ?? {})]) {
		const ratios = value?.upsampling_ratios;
		if (Array.isArray(ratios) && ratios.length > 0) {
			const samplesPerToken = ratios.reduce(
				(product, ratio) => product * ratio,
				1,
			);
			if (samplesPerToken > 0) return sampleRate / samplesPerToken;
		}
	}
	return undefined;
}

/**
 * Generate a waveform with the model's `generate`, for models whose audio is
 * decoded from generated tokens. The token budget is the requested length
 * times the frame rate the model config declares. Resolves null when the
 * pipeline has no tokenizer or model that can generate.
 */
export async function generateWaveform(pipe, text, payload) {
	const tokenizer = pipe?.tokenizer;
	const model = pipe?.model;
	if (
		typeof tokenizer !== "function" ||
		typeof model?.generate !== "function"
	) {
		return null;
	}
	const inputs = tokenizer(text, { padding: true, truncation: true });
	const requested = Number(payload?.duration);
	const seconds = Math.min(
		MAX_GENERATED_SECONDS,
		Number.isFinite(requested) && requested > 0
			? requested
			: DEFAULT_GENERATED_SECONDS,
	);
	const frameRate = audioFrameRate(model.config);
	const options = { ...inputs };
	if (frameRate)
		options.max_new_tokens = Math.max(1, Math.round(seconds * frameRate));

	const output = await model.generate(options);
	const tensor = output?.audio_values ?? output?.waveform ?? output;
	const dims = tensor?.dims;
	if (!(tensor?.data instanceof Float32Array) || !Array.isArray(dims)) {
		throw new Error("The model generated no audio samples");
	}
	// [batch, (channels,) samples]: the first channel of the first item.
	const length = dims[dims.length - 1];
	return {
		samples: tensor.data.slice(0, length),
		sampleRate: configNumber(model.config, "sampling_rate"),
	};
}

/** The speaker embedding for a requested voice, from the model's own files. */
async function speakerEmbeddings(config, voiceId) {
	const voices = Array.isArray(config.voices) ? config.voices : [];
	if (voices.length === 0) return undefined;
	const voice = voices.find((entry) => entry.id === voiceId) ?? voices[0];
	if (!voice?.path) return undefined;
	return new Float32Array(await fetchCachedArrayBuffer(voice.path));
}

/**
 * Optional request settings a pipeline may or may not use. Unknown options are
 * ignored by most pipelines; one that rejects them is retried without.
 */
function optionalSettings(payload) {
	const settings = {};
	const speed = Number(payload?.speed);
	if (Number.isFinite(speed) && speed > 0 && speed !== 1)
		settings.speed = speed;
	return settings;
}

/**
 * Streams sentence-sized PCM chunks through `sendChunk`.
 * @returns {Promise<{ sampleRate: number | undefined }>}
 */
export async function synthesize({
	bundle,
	config,
	payload,
	cancellation,
	sendChunk,
}) {
	const input = typeof payload?.input === "string" ? payload.input : "";
	if (!input.trim()) throw new MediaInputError("input is required");

	const embeddings = await speakerEmbeddings(config, payload.voice);
	const required = embeddings ? { speaker_embeddings: embeddings } : {};
	let options = { ...required, ...optionalSettings(payload) };

	// Speech is synthesized per sentence so audio starts early; other audio
	// (music, effects) is one piece.
	const pieces =
		bundle.task === "text-to-speech" ? splitSpeechText(input) : [input.trim()];

	const runPipeline = async (piece) => {
		try {
			return audioSamples(
				await runOnDevice(bundle.device, () => bundle.pipe(piece, options)),
			);
		} catch (error) {
			if (Object.keys(options).length === Object.keys(required).length) {
				throw error;
			}
			options = required;
			return audioSamples(
				await runOnDevice(bundle.device, () => bundle.pipe(piece, options)),
			);
		}
	};
	const runGenerate = (piece) =>
		runOnDevice(bundle.device, () =>
			generateWaveform(bundle.pipe, piece, payload),
		);

	let sampleRate;
	for (const piece of pieces) {
		cancellation.throwIfCancelled();
		let result;
		if (bundle.generatesAudio) {
			result = await runGenerate(piece);
		} else {
			try {
				result = await runPipeline(piece);
			} catch (error) {
				const generated = await runGenerate(piece);
				if (!generated) throw error;
				// Remembered for the loaded model: its next request skips the pipeline.
				bundle.generatesAudio = true;
				result = generated;
			}
		}
		cancellation.throwIfCancelled();
		const { samples, sampleRate: rate } = result;
		if (rate) sampleRate = rate;
		if (samples.length > 0) {
			sendChunk({ pcm: detachableCopy(samples), sampleRate });
		}
	}
	return { sampleRate };
}
