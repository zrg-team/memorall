// Decodes an encoded audio file to 16 kHz mono PCM.
//
// Runs in the runner frame: `AudioContext`/`OfflineAudioContext` do not exist
// in workers.

export const TARGET_SAMPLE_RATE = 16_000;

function offlineContextClass() {
	return (
		globalThis.OfflineAudioContext ??
		globalThis.webkitOfflineAudioContext ??
		null
	);
}

/** Averages every channel into one. */
export function downmixToMono(channels) {
	if (channels.length === 0) return new Float32Array(0);
	if (channels.length === 1) return channels[0];
	const length = Math.min(...channels.map((channel) => channel.length));
	const mono = new Float32Array(length);
	for (const channel of channels) {
		for (let i = 0; i < length; i++) mono[i] += channel[i];
	}
	const scale = 1 / channels.length;
	for (let i = 0; i < length; i++) mono[i] *= scale;
	return mono;
}

async function renderAt(buffer, sampleRate, OfflineContext) {
	const length = Math.max(1, Math.ceil(buffer.duration * sampleRate));
	const context = new OfflineContext(1, length, sampleRate);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.start(0);
	return context.startRendering();
}

/**
 * @param {ArrayBuffer} bytes Encoded file (wav, mp3, ogg, webm, m4a, ...)
 * @returns {Promise<{ pcm: Float32Array, sampleRate: number, duration: number }>}
 */
export async function decodeAudioToMono16k(bytes) {
	const OfflineContext = offlineContextClass();
	if (!OfflineContext) {
		throw new Error("Audio decoding is not available in this browser");
	}
	if (!bytes || bytes.byteLength === 0) {
		throw new Error("Audio payload is empty");
	}
	// decodeAudioData resamples to the context's rate; the 1-frame context is
	// only a decoder.
	const decoder = new OfflineContext(1, 1, TARGET_SAMPLE_RATE);
	let decoded;
	try {
		decoded = await decoder.decodeAudioData(bytes);
	} catch (error) {
		throw new Error(
			`Could not decode the audio file: ${error?.message ?? "unsupported format"}`,
		);
	}

	const resampled =
		decoded.sampleRate === TARGET_SAMPLE_RATE
			? decoded
			: await renderAt(decoded, TARGET_SAMPLE_RATE, OfflineContext);
	const channels = [];
	for (let index = 0; index < resampled.numberOfChannels; index++) {
		channels.push(resampled.getChannelData(index));
	}
	// Copy: the AudioBuffer owns its channel data and it is about to be
	// transferred to the worker.
	const pcm = Float32Array.from(downmixToMono(channels));
	return {
		pcm,
		sampleRate: TARGET_SAMPLE_RATE,
		duration: pcm.length / TARGET_SAMPLE_RATE,
	};
}
