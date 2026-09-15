import type {
	GeneratedImageData,
	ImageGenerateParams,
	ImageGenerationStreamEvent,
	ImagesResponse,
	MediaPayload,
	SpeechCreateParams,
	SpeechResponse,
	SpeechStreamEvent,
	Transcription,
	TranscriptionCreateParams,
	TranscriptionStreamEvent,
} from "@/types/openai-media";
import {
	base64ToBytes,
	bytesToBase64,
	concatFloat32,
	encodeWav,
	mimeTypeToExtension,
	pcm16ToFloat32,
} from "./media-encoding";
import { mediaPayloadToBytes } from "./media-payload";

/** `response_format: "pcm"` is 24 kHz 16-bit mono by the API's definition. */
export const OPENAI_PCM_SAMPLE_RATE = 24_000;

const isEventStream = (response: Response) =>
	(response.headers.get("content-type") ?? "").includes("text/event-stream");

/**
 * Whether a failed request is worth retrying with a smaller option set.
 * OpenAI-compatible servers differ in which optional parameters they accept
 * (streaming, verbose output, response formats); they reject the unknown ones
 * with a 4xx, so features are negotiated by trying, never by model name.
 */
const rejectedOption = (response: Response) =>
	response.status === 400 || response.status === 404 || response.status === 422;

export interface OpenAIMediaTransport {
	baseURL: string;
	headers(): Record<string, string>;
	isOpenRouter: boolean;
}

/** Yield each JSON `data:` payload of a server-sent event stream. */
export async function* readSseJson(
	response: Response,
): AsyncIterableIterator<Record<string, unknown>> {
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8");
	let buffer = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const data = trimmed.slice(5).trim();
				if (!data || data === "[DONE]") continue;
				try {
					yield JSON.parse(data) as Record<string, unknown>;
				} catch {
					// Keep-alive comments and malformed lines are not events.
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}

async function failure(response: Response, label: string): Promise<Error> {
	const text = await response.text().catch(() => "");
	return new Error(
		`${label} failed: ${response.status} ${response.statusText} ${text}`.trim(),
	);
}

function wavDurationMs(bytes: Uint8Array, fallbackRate: number): number {
	if (bytes.byteLength < 44) return 0;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const isWav =
		String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
		String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE";
	if (!isWav) return 0;
	const rate = view.getUint32(24, true) || fallbackRate;
	const blockAlign = view.getUint16(32, true) || 2;
	return Math.round(((bytes.byteLength - 44) / blockAlign / rate) * 1000);
}

export async function createSpeech(
	transport: OpenAIMediaTransport,
	request: SpeechCreateParams,
): Promise<SpeechResponse> {
	const format = request.response_format ?? "wav";
	const response = await fetch(`${transport.baseURL}/audio/speech`, {
		method: "POST",
		headers: { ...transport.headers(), "Content-Type": "application/json" },
		body: JSON.stringify({
			model: request.model,
			input: request.input,
			voice: request.voice,
			instructions: request.instructions,
			speed: request.speed,
			response_format: format,
		}),
		signal: request.signal,
	});
	if (!response.ok) throw await failure(response, "Speech synthesis");

	const bytes = new Uint8Array(await response.arrayBuffer());
	const mimeType =
		response.headers.get("content-type")?.split(";")[0] ||
		(format === "mp3" ? "audio/mpeg" : `audio/${format}`);
	return {
		object: "audio.speech",
		model: request.model,
		voice: request.voice,
		audio: { kind: "bytes", bytes, mimeType },
		sample_rate: OPENAI_PCM_SAMPLE_RATE,
		duration_ms: wavDurationMs(bytes, OPENAI_PCM_SAMPLE_RATE),
		usage: { input_characters: request.input.length },
	};
}

export async function* streamSpeech(
	transport: OpenAIMediaTransport,
	request: SpeechCreateParams,
): AsyncIterableIterator<SpeechStreamEvent> {
	const response = await fetch(`${transport.baseURL}/audio/speech`, {
		method: "POST",
		headers: { ...transport.headers(), "Content-Type": "application/json" },
		body: JSON.stringify({
			model: request.model,
			input: request.input,
			voice: request.voice,
			instructions: request.instructions,
			speed: request.speed,
			response_format: "pcm",
			stream_format: "sse",
		}),
		signal: request.signal,
	});

	if (!response.ok) {
		if (!rejectedOption(response))
			throw await failure(response, "Speech synthesis");
		// The server does not stream speech: fall back to one file.
		yield {
			type: "speech.audio.done",
			result: await createSpeech(transport, request),
		};
		return;
	}

	const frames: Float32Array[] = [];
	let seq = 0;
	if (isEventStream(response)) {
		for await (const event of readSseJson(response)) {
			if (
				event.type === "speech.audio.delta" &&
				typeof event.audio === "string"
			) {
				frames.push(pcm16ToFloat32(base64ToBytes(event.audio)));
				yield {
					type: "speech.audio.delta",
					audio: event.audio,
					sample_rate: OPENAI_PCM_SAMPLE_RATE,
					seq: seq++,
				};
			}
		}
	} else {
		// Accepted the request but ignored `stream_format`: the body is raw PCM.
		frames.push(pcm16ToFloat32(new Uint8Array(await response.arrayBuffer())));
	}

	const samples = concatFloat32(frames);
	yield {
		type: "speech.audio.done",
		result: {
			object: "audio.speech",
			model: request.model,
			voice: request.voice,
			audio: {
				kind: "bytes",
				bytes: encodeWav(samples, OPENAI_PCM_SAMPLE_RATE),
				mimeType: "audio/wav",
			},
			sample_rate: OPENAI_PCM_SAMPLE_RATE,
			duration_ms: Math.round((samples.length / OPENAI_PCM_SAMPLE_RATE) * 1000),
			usage: { input_characters: request.input.length },
		},
	};
}

async function transcriptionForm(
	request: TranscriptionCreateParams,
	options: { stream: boolean; verbose: boolean },
): Promise<FormData> {
	const bytes = await mediaPayloadToBytes(request.file);
	const extension = mimeTypeToExtension(request.file.mimeType) || ".wav";
	const form = new FormData();
	form.append(
		"file",
		new Blob([bytes.slice().buffer], { type: request.file.mimeType }),
		`audio${extension}`,
	);
	form.append("model", request.model);
	if (request.language) form.append("language", request.language);
	if (request.prompt) form.append("prompt", request.prompt);
	if (request.temperature !== undefined) {
		form.append("temperature", String(request.temperature));
	}
	if (request.task === "translate") form.append("task", "translate");
	form.append("response_format", options.verbose ? "verbose_json" : "json");
	if (options.verbose) {
		for (const granularity of request.timestamp_granularities ?? ["segment"]) {
			form.append("timestamp_granularities[]", granularity);
		}
	}
	if (options.stream) form.append("stream", "true");
	return form;
}

function toTranscription(data: Record<string, unknown>): Transcription {
	const segments = Array.isArray(data.segments)
		? data.segments.map((segment, index) => {
				const entry = segment as Record<string, unknown>;
				return {
					id: typeof entry.id === "number" ? entry.id : index,
					start: Number(entry.start ?? 0),
					end: Number(entry.end ?? 0),
					text: String(entry.text ?? "").trim(),
				};
			})
		: undefined;
	const words = Array.isArray(data.words)
		? data.words.map((word) => {
				const entry = word as Record<string, unknown>;
				return {
					word: String(entry.word ?? ""),
					start: Number(entry.start ?? 0),
					end: Number(entry.end ?? 0),
				};
			})
		: undefined;
	return {
		text: String(data.text ?? "").trim(),
		language: typeof data.language === "string" ? data.language : undefined,
		duration: typeof data.duration === "number" ? data.duration : undefined,
		segments,
		words,
	};
}

export async function createTranscription(
	transport: OpenAIMediaTransport,
	request: TranscriptionCreateParams,
): Promise<Transcription> {
	// Ask for timestamps first; servers that only return plain JSON reject
	// `verbose_json`, and get the request again without it.
	for (const verbose of [true, false]) {
		const response = await fetch(`${transport.baseURL}/audio/transcriptions`, {
			method: "POST",
			// FormData sets its own multipart boundary.
			headers: transport.headers(),
			body: await transcriptionForm(request, { stream: false, verbose }),
			signal: request.signal,
		});
		if (response.ok) {
			return toTranscription(
				(await response.json()) as Record<string, unknown>,
			);
		}
		if (!verbose || !rejectedOption(response)) {
			throw await failure(response, "Transcription");
		}
	}
	throw new Error("Transcription failed");
}

export async function* streamTranscription(
	transport: OpenAIMediaTransport,
	request: TranscriptionCreateParams,
): AsyncIterableIterator<TranscriptionStreamEvent> {
	const response = await fetch(`${transport.baseURL}/audio/transcriptions`, {
		method: "POST",
		headers: transport.headers(),
		body: await transcriptionForm(request, { stream: true, verbose: false }),
		signal: request.signal,
	});

	if (!response.ok) {
		if (!rejectedOption(response))
			throw await failure(response, "Transcription");
		yield {
			type: "transcript.text.done",
			result: await createTranscription(transport, request),
		};
		return;
	}

	if (!isEventStream(response)) {
		// Streaming ignored: the body is the finished transcription.
		const data = (await response.json()) as Record<string, unknown>;
		yield { type: "transcript.text.done", result: toTranscription(data) };
		return;
	}

	let text = "";
	for await (const event of readSseJson(response)) {
		if (
			event.type === "transcript.text.delta" &&
			typeof event.delta === "string"
		) {
			text += event.delta;
			yield { type: "transcript.text.delta", delta: event.delta };
		} else if (event.type === "transcript.text.done") {
			text = typeof event.text === "string" ? event.text : text;
		}
	}
	yield { type: "transcript.text.done", result: { text: text.trim() } };
}

export async function* generateImages(
	transport: OpenAIMediaTransport,
	request: ImageGenerateParams,
): AsyncIterableIterator<ImageGenerationStreamEvent> {
	yield { type: "image_generation.progress", percent: 0 };

	if (transport.isOpenRouter) {
		yield* generateImagesViaChat(transport, request);
		return;
	}
	if (request.image?.length) {
		const edited = await editImages(transport, request);
		if (edited) {
			yield { type: "image_generation.completed", result: edited };
			return;
		}
	}

	const post = (withResponseFormat: boolean) =>
		fetch(`${transport.baseURL}/images/generations`, {
			method: "POST",
			headers: { ...transport.headers(), "Content-Type": "application/json" },
			body: JSON.stringify({
				model: request.model,
				prompt: request.prompt,
				n: request.n,
				size: request.size,
				quality: request.quality,
				output_format: request.output_format,
				...(withResponseFormat ? { response_format: "b64_json" } : {}),
			}),
			signal: request.signal,
		});
	// Some servers always answer in base64 and reject `response_format`.
	let response = await post(true);
	if (!response.ok && rejectedOption(response)) {
		response = await post(false);
	}
	if (!response.ok) throw await failure(response, "Image generation");

	yield {
		type: "image_generation.completed",
		result: await imagesResult(response, request),
	};
}

async function imagesResult(
	response: Response,
	request: ImageGenerateParams,
): Promise<ImagesResponse> {
	const data = (await response.json()) as {
		created?: number;
		data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
	};
	const mimeType = `image/${request.output_format ?? "png"}`;
	return {
		created: data.created ?? Math.floor(Date.now() / 1000),
		data: (data.data ?? []).map((image) => ({
			b64_json: image.b64_json,
			url: image.url,
			mime_type: mimeType,
			revised_prompt: image.revised_prompt,
		})),
	};
}

const payloadBlob = async (payload: MediaPayload) =>
	new Blob([(await mediaPayloadToBytes(payload)) as BlobPart], {
		type: payload.mimeType,
	});

const fileNameFor = (blob: Blob, name: string) =>
	`${name}${mimeTypeToExtension(blob.type) || ".png"}`;

/**
 * `/v1/images/edits`, asking for less on each rejection: every image
 * (`image[]`) with the mask, then the first image with the mask, then the
 * first image alone. Resolves null when the server has no edits endpoint, so
 * the caller falls back to a generation from the prompt.
 */
async function editImages(
	transport: OpenAIMediaTransport,
	request: ImageGenerateParams,
): Promise<ImagesResponse | null> {
	const images = await Promise.all((request.image ?? []).map(payloadBlob));
	const mask = request.mask ? await payloadBlob(request.mask) : undefined;
	const attempts: { images: Blob[]; mask?: Blob }[] = [
		{ images, mask },
		...(images.length > 1 ? [{ images: images.slice(0, 1), mask }] : []),
		...(mask ? [{ images: images.slice(0, 1) }] : []),
	];

	const post = (
		attempt: (typeof attempts)[number],
		withResponseFormat: boolean,
	) => {
		const form = new FormData();
		form.append("model", request.model);
		form.append("prompt", request.prompt);
		const field = attempt.images.length > 1 ? "image[]" : "image";
		attempt.images.forEach((image, index) => {
			form.append(field, image, fileNameFor(image, `image-${index + 1}`));
		});
		if (attempt.mask) form.append("mask", attempt.mask, "mask.png");
		if (request.n) form.append("n", String(request.n));
		if (request.size) form.append("size", request.size);
		if (request.quality) form.append("quality", request.quality);
		if (request.output_format) {
			form.append("output_format", request.output_format);
		}
		if (withResponseFormat) form.append("response_format", "b64_json");
		return fetch(`${transport.baseURL}/images/edits`, {
			method: "POST",
			headers: transport.headers(),
			body: form,
			signal: request.signal,
		});
	};

	let response: Response | null = null;
	for (const attempt of attempts) {
		response = await post(attempt, true);
		if (response.status === 404 || response.status === 405) return null;
		if (!response.ok && rejectedOption(response)) {
			response = await post(attempt, false);
		}
		if (response.ok || !rejectedOption(response)) break;
	}
	if (!response?.ok) {
		throw response
			? await failure(response, "Image edit")
			: new Error("Image edit failed");
	}
	return imagesResult(response, request);
}

/** The prompt, followed by any images to work from as data URLs. */
async function chatContent(request: ImageGenerateParams) {
	if (!request.image?.length) return request.prompt;
	const images = await Promise.all(
		request.image.map(async (image) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:${image.mimeType};base64,${bytesToBase64(
					await mediaPayloadToBytes(image),
				)}`,
			},
		})),
	);
	return [{ type: "text" as const, text: request.prompt }, ...images];
}

/**
 * OpenRouter exposes image models through chat completions with
 * `modalities: ["image", "text"]`; images come back as data URLs on the
 * assistant message.
 */
async function* generateImagesViaChat(
	transport: OpenAIMediaTransport,
	request: ImageGenerateParams,
): AsyncIterableIterator<ImageGenerationStreamEvent> {
	const response = await fetch(`${transport.baseURL}/chat/completions`, {
		method: "POST",
		headers: { ...transport.headers(), "Content-Type": "application/json" },
		body: JSON.stringify({
			model: request.model,
			messages: [{ role: "user", content: await chatContent(request) }],
			modalities: ["image", "text"],
		}),
		signal: request.signal,
	});
	if (!response.ok) throw await failure(response, "Image generation");

	const data = (await response.json()) as {
		created?: number;
		choices?: {
			message?: {
				content?: string;
				images?: { image_url?: { url?: string } }[];
			};
		}[];
	};
	const message = data.choices?.[0]?.message;
	const images = (message?.images ?? []).flatMap(
		(image): GeneratedImageData[] => {
			const url = image.image_url?.url ?? "";
			const match = /^data:([^;]+);base64,(.*)$/.exec(url);
			return match
				? [
						{
							b64_json: match[2],
							mime_type: match[1],
							revised_prompt: message?.content,
						},
					]
				: url
					? [{ url, revised_prompt: message?.content }]
					: [];
		},
	);
	if (images.length === 0) {
		throw new Error(
			message?.content
				? `The model answered without an image: ${message.content}`
				: "The model returned no image",
		);
	}
	yield {
		type: "image_generation.completed",
		result: {
			created: data.created ?? Math.floor(Date.now() / 1000),
			data: images,
		},
	};
}
