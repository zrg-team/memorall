// Translate OpenAI-shaped chat content into the shape wllama v3 expects.
//
// The app speaks the OpenAI wire format end to end, where an image is a URL:
// `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`.
// wllama takes decoded bytes instead — `{ type: "image", data: ArrayBuffer }` —
// and swaps each one for the model's media marker before inference. Handing it
// an OpenAI part makes it read `part.data`, find `undefined`, and push that into
// the media list, so the image never reaches the model.

const DATA_URL_HEADER = /^data:([^;,]*)((?:;[^,]*)?),/;

const MEDIA_PART_TYPES = {
	image_url: { modality: "image", wllamaType: "image" },
	input_audio: { modality: "audio", wllamaType: "audio" },
};

/**
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

/**
 * @param {string} url
 * @returns {{ mimeType: string, data: ArrayBuffer }}
 */
export function decodeDataUrl(url) {
	const header = url.match(DATA_URL_HEADER);
	if (!header) {
		throw new Error("Malformed data: URL in message content");
	}
	const payload = url.slice(header[0].length);
	const mimeType = header[1] || "";
	if (/;base64/i.test(header[2] || "")) {
		return { mimeType, data: base64ToArrayBuffer(payload) };
	}
	return {
		mimeType,
		data: new TextEncoder().encode(decodeURIComponent(payload)).buffer,
	};
}

/**
 * Bytes for a media URL. Attachments arrive as data: URLs; a remote URL is
 * fetched so a model still sees the image the user pointed at.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ mimeType: string, data: ArrayBuffer }>}
 */
export async function loadMediaBytes(url, fetchImpl) {
	if (typeof url !== "string" || url.length === 0) {
		throw new Error("Message content has a media part with no URL");
	}
	if (url.startsWith("data:")) {
		return decodeDataUrl(url);
	}
	const doFetch = fetchImpl ?? fetch;
	const response = await doFetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch media (${response.status}): ${url}`);
	}
	return {
		mimeType: response.headers?.get?.("content-type") || "",
		data: await response.arrayBuffer(),
	};
}

async function toWllamaContentPart(part, options) {
	if (!part || typeof part !== "object") return part;
	if (part.type === "text") return part;
	// Already in wllama's shape — a caller may hand us bytes directly.
	if (part.type === "image" || part.type === "audio") return part;

	const media = MEDIA_PART_TYPES[part.type];
	if (!media) return part;

	if (!options.supportsModality(media.modality)) {
		throw new Error(
			`The loaded model does not accept ${media.modality} input. Load a multimodal model (one with an mmproj projector) to send ${media.modality}.`,
		);
	}

	if (part.type === "input_audio") {
		// OpenAI carries audio as bare base64 rather than a data: URL.
		const encoded = part.input_audio?.data;
		if (typeof encoded !== "string" || encoded.length === 0) {
			throw new Error("Message content has an audio part with no data");
		}
		return { type: "audio", data: base64ToArrayBuffer(encoded) };
	}

	const { data } = await loadMediaBytes(part.image_url?.url, options.fetchImpl);
	return { type: media.wllamaType, data };
}

/**
 * Rewrite every message's content into wllama's content parts.
 *
 * String content and non-media parts pass through untouched, so a text-only
 * conversation comes back structurally identical.
 *
 * @param {any[]} messages
 * @param {{ supportsModality?: (modality: string) => boolean, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<any[]>}
 */
export async function toWllamaMessages(messages, options = {}) {
	if (!Array.isArray(messages)) return messages;

	const resolved = {
		supportsModality: options.supportsModality ?? (() => true),
		fetchImpl: options.fetchImpl,
	};

	const converted = [];
	for (const message of messages) {
		if (!message || !Array.isArray(message.content)) {
			converted.push(message);
			continue;
		}
		const content = [];
		for (const part of message.content) {
			content.push(await toWllamaContentPart(part, resolved));
		}
		converted.push({ ...message, content });
	}
	return converted;
}

/** True when any message carries a media part that needs a projector. */
export function hasMediaContent(messages) {
	if (!Array.isArray(messages)) return false;
	return messages.some(
		(message) =>
			Array.isArray(message?.content) &&
			message.content.some(
				(part) =>
					part?.type === "image" ||
					part?.type === "audio" ||
					!!MEDIA_PART_TYPES[part?.type],
			),
	);
}
