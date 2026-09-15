/**
 * Binary helpers for media endpoints.
 *
 * Audio and images cross `chrome.runtime` messaging as base64 or as a
 * documents-filesystem path, never as ArrayBuffers (the channel is JSON only),
 * so these conversions sit on every media boundary.
 */

const BASE64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + BASE64_CHUNK),
		);
	}
	return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
	const clean = base64.includes(",")
		? base64.slice(base64.indexOf(",") + 1)
		: base64;
	const binary = atob(clean);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

/** Float32 [-1, 1] mono samples to little-endian signed 16-bit PCM. */
export function float32ToPcm16(samples: Float32Array): Uint8Array {
	const out = new Uint8Array(samples.length * 2);
	const view = new DataView(out.buffer);
	for (let index = 0; index < samples.length; index++) {
		const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
		view.setInt16(
			index * 2,
			clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
			true,
		);
	}
	return out;
}

export function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
	const sampleCount = Math.floor(pcm.byteLength / 2);
	const view = new DataView(pcm.buffer, pcm.byteOffset, sampleCount * 2);
	const out = new Float32Array(sampleCount);
	for (let index = 0; index < sampleCount; index++) {
		out[index] = view.getInt16(index * 2, true) / 0x8000;
	}
	return out;
}

export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/** 16-bit mono WAV, the one format every browser can play and download. */
export function encodeWav(
	samples: Float32Array,
	sampleRate: number,
): Uint8Array {
	const pcm = float32ToPcm16(samples);
	const buffer = new ArrayBuffer(44 + pcm.byteLength);
	const view = new DataView(buffer);
	const writeAscii = (offset: number, text: string) => {
		for (let index = 0; index < text.length; index++) {
			view.setUint8(offset + index, text.charCodeAt(index));
		}
	};

	writeAscii(0, "RIFF");
	view.setUint32(4, 36 + pcm.byteLength, true);
	writeAscii(8, "WAVE");
	writeAscii(12, "fmt ");
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	writeAscii(36, "data");
	view.setUint32(40, pcm.byteLength, true);

	const out = new Uint8Array(buffer);
	out.set(pcm, 44);
	return out;
}

/**
 * Re-batches a stream of small PCM frames into chunks of roughly `targetMs`.
 *
 * Streaming speech models emit many small frames. Forwarding each one as its
 * own job progress event floods `chrome.runtime`; a few hundred milliseconds
 * per event keeps playback responsive at a fraction of the traffic.
 */
export class PcmChunkBatcher {
	private pending: Float32Array[] = [];
	private pendingSamples = 0;

	constructor(
		private readonly sampleRate: number,
		private readonly targetMs = 400,
	) {}

	/** Returns a batch once enough audio has accumulated. */
	push(frame: Float32Array): Float32Array | null {
		if (frame.length === 0) return null;
		this.pending.push(frame);
		this.pendingSamples += frame.length;
		if ((this.pendingSamples / this.sampleRate) * 1000 < this.targetMs) {
			return null;
		}
		return this.flush();
	}

	flush(): Float32Array | null {
		if (this.pendingSamples === 0) return null;
		const batch = concatFloat32(this.pending);
		this.pending = [];
		this.pendingSamples = 0;
		return batch;
	}
}

export function mimeTypeToExtension(mimeType: string): string {
	const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	switch (normalized) {
		case "audio/wav":
		case "audio/x-wav":
		case "audio/wave":
			return ".wav";
		case "audio/mpeg":
			return ".mp3";
		case "audio/ogg":
			return ".ogg";
		case "audio/webm":
			return ".webm";
		case "audio/mp4":
		case "audio/aac":
			return ".m4a";
		case "audio/flac":
			return ".flac";
		case "image/png":
			return ".png";
		case "image/jpeg":
			return ".jpg";
		case "image/webp":
			return ".webp";
		case "image/gif":
			return ".gif";
		default:
			return "";
	}
}
