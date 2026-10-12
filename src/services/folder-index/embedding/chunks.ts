import type { IndexedFileInfo } from "../types";
import { MAX_EMBEDDING_CHUNKS_PER_FILE } from "../constants";
import type { ChunkLocation, PreparedChunk } from "./types";

export const TEXT_CHUNK_CHARS = 2000;
export const TEXT_OVERLAP_CHARS = 200;
export const AUDIO_CHUNK_SECONDS = 30;
export const VIDEO_CHUNK_SECONDS = 20;
export const MEDIA_OVERLAP_SECONDS = 2;
export const AUDIO_SAMPLE_RATE = 16000;

/** Keeps locations in the original text, including whitespace at chunk boundaries. */
export function* textChunks(
	text: string,
	title: string,
	location: ChunkLocation = {},
): Generator<PreparedChunk> {
	for (let start = 0; start < text.length; ) {
		let end = Math.min(start + TEXT_CHUNK_CHARS, text.length);
		if (end < text.length) {
			const boundary = text.lastIndexOf(" ", end);
			if (boundary > start + TEXT_CHUNK_CHARS / 2) end = boundary;
			// Do not split UTF-16 surrogate pairs.
			if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
		}
		const content = text.slice(start, end);
		if (content.trim())
			yield {
				kind: "text",
				text: content,
				location: { ...location, startChar: start, endChar: end },
				input: { kind: "text", text: content, title },
			};
		if (end === text.length) break;
		start = end - TEXT_OVERLAP_CHARS;
		if (/[\uDC00-\uDFFF]/.test(text[start])) start--;
	}
}

export function* mediaRanges(
	duration: number,
	window: number,
): Generator<[number, number]> {
	if (
		!Number.isFinite(duration) ||
		duration <= 0 ||
		window <= MEDIA_OVERLAP_SECONDS
	)
		throw new Error("Invalid media duration or chunk window");
	for (
		let start = 0;
		start < duration;
		start += window - MEDIA_OVERLAP_SECONDS
	) {
		const end = Math.min(start + window, duration);
		yield [start, end];
		if (end === duration) break;
	}
}

export const canvasBytes = async (
	canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<ArrayBuffer> => {
	const blob =
		"convertToBlob" in canvas
			? await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
			: await new Promise<Blob>((resolve, reject) =>
					canvas.toBlob(
						(value) =>
							value
								? resolve(value)
								: reject(new Error("Could not render media frame")),
						"image/jpeg",
						0.85,
					),
				);
	return blob.arrayBuffer();
};

/** Downmix and resample into a bounded window, preserving gaps and source timestamps. */
export const copyAudioWindow = (
	target: Float32Array,
	start: number,
	timestamp: number,
	buffer: AudioBuffer,
): void => {
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
		buffer.getChannelData(i),
	);
	const first = Math.max(0, Math.ceil((timestamp - start) * AUDIO_SAMPLE_RATE));
	const last = Math.min(
		target.length,
		Math.ceil((timestamp + buffer.duration - start) * AUDIO_SAMPLE_RATE),
	);
	for (let i = first; i < last; i++) {
		const position =
			(start + i / AUDIO_SAMPLE_RATE - timestamp) * buffer.sampleRate;
		const left = Math.max(0, Math.min(buffer.length - 1, Math.floor(position)));
		const right = Math.min(buffer.length - 1, left + 1);
		const fraction = Math.max(0, Math.min(1, position - left));
		let value = 0;
		for (const channel of channels)
			value += channel[left] * (1 - fraction) + channel[right] * fraction;
		target[i] = value / channels.length;
	}
};

const bytesBuffer = (bytes: Uint8Array): ArrayBuffer =>
	new Uint8Array(bytes).buffer;
const is = (file: IndexedFileInfo, kind: string, extension: RegExp) =>
	file.documentType === kind ||
	file.mimeType?.startsWith(`${kind}/`) ||
	extension.test(file.name);

/** Reads actual content. Unknown binary formats fail visibly instead of embedding filenames. */
export async function* extractEmbeddingChunks(
	file: IndexedFileInfo,
	bytes: Uint8Array,
	options: { skipChunks?: number; signal?: AbortSignal } = {},
): AsyncGenerator<PreparedChunk> {
	let skip = Math.max(0, Math.floor(options.skipChunks ?? 0));
	const remaining = function* (chunks: Iterable<PreparedChunk>) {
		for (const chunk of chunks) {
			options.signal?.throwIfAborted();
			if (skip > 0) {
				skip--;
				continue;
			}
			yield chunk;
		}
	};
	const limitError = () =>
		new Error(`File exceeds the ${MAX_EMBEDDING_CHUNKS_PER_FILE}-chunk limit`);
	let textCount = 0;
	const selectText = (text: string, location: ChunkLocation = {}) => {
		for (const _chunk of textChunks(text, file.name, location))
			if (++textCount > MAX_EMBEDDING_CHUNKS_PER_FILE) throw limitError();
		return remaining(textChunks(text, file.name, location));
	};
	const rangeCount = (duration: number, window: number) => {
		let count = 0;
		for (const _range of mediaRanges(duration, window))
			if (++count > MAX_EMBEDDING_CHUNKS_PER_FILE) break;
		return count;
	};
	options.signal?.throwIfAborted();
	if (is(file, "image", /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i)) {
		if (skip > 0) return;
		yield {
			kind: "image",
			location: {},
			input: {
				kind: "image",
				bytes: bytesBuffer(bytes),
				mimeType: file.mimeType ?? "application/octet-stream",
			},
		};
		return;
	}
	const video = is(file, "video", /\.(mp4|webm|mov|mkv|m4v|avi)$/i);
	const audio = is(file, "audio", /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i);
	if (video || audio) {
		const { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink } =
			await import("mediabunny");
		const input = new Input({
			source: new BlobSource(new Blob([bytesBuffer(bytes)])),
			formats: ALL_FORMATS,
		});
		try {
			const audioTrack = await input.getPrimaryAudioTrack();
			const audioDuration = audioTrack
				? await audioTrack.computeDuration()
				: undefined;
			if (
				audioDuration !== undefined &&
				rangeCount(audioDuration, AUDIO_CHUNK_SECONDS) >
					MAX_EMBEDDING_CHUNKS_PER_FILE
			)
				throw limitError();
			if (video) {
				const track = await input.getPrimaryVideoTrack();
				if (!track || !(await track.canDecode()))
					throw new Error("This browser cannot decode the video track");
				const duration = await track.computeDuration();
				if (
					rangeCount(duration, VIDEO_CHUNK_SECONDS) +
						(audioDuration !== undefined
							? rangeCount(audioDuration, AUDIO_CHUNK_SECONDS)
							: 0) >
					MAX_EMBEDDING_CHUNKS_PER_FILE
				)
					throw limitError();
				const sink = new CanvasSink(track, {
					width: 512,
					height: 512,
					fit: "contain",
					poolSize: 1,
				});
				for (const [start, end] of mediaRanges(duration, VIDEO_CHUNK_SECONDS)) {
					options.signal?.throwIfAborted();
					if (skip > 0) {
						skip--;
						continue;
					}
					const times = Array.from(
						{ length: Math.ceil(end - start) },
						(_, i) => start + i,
					);
					const frames: Array<{ bytes: ArrayBuffer; timestamp: number }> = [];
					for await (const frame of sink.canvasesAtTimestamps(times)) {
						options.signal?.throwIfAborted();
						if (frame)
							frames.push({
								bytes: await canvasBytes(frame.canvas),
								timestamp: Math.max(0, frame.timestamp - start),
							});
					}
					if (!frames.length)
						throw new Error("No video frames could be decoded");
					yield {
						kind: "video",
						location: { startSeconds: start, endSeconds: end },
						input: { kind: "video", frames, duration: end - start },
					};
				}
			}
			const track = audioTrack;
			if (audio && !track) throw new Error("No audio track found");
			if (track) {
				if (!(await track.canDecode()))
					throw new Error("This browser cannot decode the audio track");
				const sink = new AudioBufferSink(track);
				for (const [start, end] of mediaRanges(
					audioDuration!,
					AUDIO_CHUNK_SECONDS,
				)) {
					options.signal?.throwIfAborted();
					if (skip > 0) {
						skip--;
						continue;
					}
					const samples = new Float32Array(
						Math.ceil((end - start) * AUDIO_SAMPLE_RATE),
					);
					let decoded = false;
					for await (const part of sink.buffers(start, end)) {
						options.signal?.throwIfAborted();
						copyAudioWindow(samples, start, part.timestamp, part.buffer);
						decoded = true;
					}
					if (!decoded) throw new Error("No audio samples could be decoded");
					yield {
						kind: "audio",
						location: { startSeconds: start, endSeconds: end },
						input: { kind: "audio", samples, sampleRate: AUDIO_SAMPLE_RATE },
					};
				}
			}
		} finally {
			input.dispose();
		}
		return;
	}
	if (file.documentType === "pdf" || /\.pdf$/i.test(file.name)) {
		const { openPDFDocument } = await import(
			"@/main/modules/files/handlers/pdf-extraction"
		);
		const { doc, close } = await openPDFDocument(new Uint8Array(bytes));
		try {
			if (doc.numPages > MAX_EMBEDDING_CHUNKS_PER_FILE) throw limitError();
			for (let number = 1; number <= doc.numPages; number++) {
				options.signal?.throwIfAborted();
				const page = await doc.getPage(number);
				const content = await page.getTextContent();
				const text = content.items
					.map((item) =>
						"str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
					)
					.join("");
				if (text.trim()) yield* selectText(text, { page: number });
				else {
					if (skip > 0) {
						skip--;
						page.cleanup();
						continue;
					}
					const original = page.getViewport({ scale: 1 });
					const viewport = page.getViewport({
						scale: Math.min(
							2,
							1024 / Math.max(original.width, original.height),
						),
					});
					const canvas = document.createElement("canvas");
					canvas.width = Math.ceil(viewport.width);
					canvas.height = Math.ceil(viewport.height);
					const context = canvas.getContext("2d");
					if (!context) throw new Error("PDF page rendering is unavailable");
					await page.render({ canvas, canvasContext: context, viewport })
						.promise;
					yield {
						kind: "image",
						location: { page: number },
						input: {
							kind: "image",
							bytes: await canvasBytes(canvas),
							mimeType: "image/jpeg",
						},
					};
					canvas.width = 0;
					canvas.height = 0;
				}
				page.cleanup();
			}
		} finally {
			await close();
		}
		return;
	}
	if (file.documentType === "excel" || /\.(xlsx?|ods)$/i.test(file.name)) {
		const { parseExcelFile, sheetToCsv } = await import(
			"@/main/modules/files/handlers/excel-extraction"
		);
		const book = await parseExcelFile(bytes);
		for (const sheet of book.SheetNames)
			yield* selectText(sheetToCsv(book, sheet), { sheet });
		return;
	}
	if (/\.docx$/i.test(file.name)) {
		const { docxToMarkdown } = await import(
			"@/main/modules/files/handlers/docx-extraction"
		);
		yield* selectText(docxToMarkdown(bytes));
		return;
	}
	if (file.documentType === "presentation" || /\.pptx?$/i.test(file.name)) {
		const { readPresentation, presentationToMarkdown } = await import(
			"@/main/modules/files/handlers/pptx-extraction"
		);
		yield* selectText(presentationToMarkdown(await readPresentation(bytes)));
		return;
	}
	if (
		file.documentType === "text" ||
		file.documentType === "markdown" ||
		file.mimeType?.startsWith("text/") ||
		/\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|css|js|ts|tsx|jsx|py|rb|go|rs|java|c|cpp|h|sh|sql|toml|ini|log|okf)$/i.test(
			file.name,
		)
	) {
		yield* selectText(new TextDecoder().decode(bytes));
		return;
	}
	throw new Error("This file format cannot be embedded yet");
}
