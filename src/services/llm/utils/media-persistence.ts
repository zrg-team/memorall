import type {
	GeneratedImageData,
	ImageToolImage,
	MediaPayload,
} from "@/types/openai-media";
import { base64ToBytes, mimeTypeToExtension } from "./media-encoding";

type StoredPayload = Extract<MediaPayload, { kind: "file" }>;

async function filesystem() {
	const { documentFileSystemService } = await import(
		"@/services/filesystem/document-filesystem"
	);
	return documentFileSystemService;
}

/**
 * Write a media payload into the documents filesystem and return its path
 * form. A payload that is already a file is returned untouched, so every
 * consumer can call this without knowing where the media was produced.
 */
export async function persistMediaPayload(
	payload: MediaPayload,
	options: {
		kind: "audio" | "image";
		folder?: "generated" | "recordings" | "inputs";
	},
): Promise<StoredPayload> {
	if (payload.kind === "file") {
		return payload;
	}
	const bytes =
		payload.kind === "bytes" ? payload.bytes : base64ToBytes(payload.data);
	const fs = await filesystem();
	const path = await fs.saveMediaFile(bytes, {
		kind: options.kind,
		extension:
			mimeTypeToExtension(payload.mimeType) ||
			(options.kind === "audio" ? ".wav" : ".png"),
		folder: options.folder,
	});
	return { kind: "file", path, mimeType: payload.mimeType };
}

/** Swap inline base64 image data for a stored file path. */
export async function persistGeneratedImage(
	image: GeneratedImageData,
	fetcher: typeof fetch = fetch,
): Promise<GeneratedImageData> {
	if (image.path) {
		return image;
	}
	if (image.b64_json) {
		const mimeType = image.mime_type ?? "image/png";
		const stored = await persistMediaPayload(
			{ kind: "base64", data: image.b64_json, mimeType },
			{ kind: "image", folder: "generated" },
		);
		const { b64_json: _inline, ...rest } = image;
		return { ...rest, path: stored.path, mime_type: mimeType };
	}
	if (image.url) {
		// Servers that answer with URLs (which usually expire) are stored too,
		// so a generation never finishes with images that are not kept.
		const response = await fetcher(image.url);
		if (!response.ok) {
			throw new Error(
				`Could not download the generated image (${response.status})`,
			);
		}
		const mimeType =
			response.headers.get("content-type")?.split(";")[0] ||
			image.mime_type ||
			"image/png";
		const stored = await persistMediaPayload(
			{
				kind: "bytes",
				bytes: new Uint8Array(await response.arrayBuffer()),
				mimeType,
			},
			{ kind: "image", folder: "generated" },
		);
		return { ...image, path: stored.path, mime_type: mimeType };
	}
	return image;
}

export async function persistToolImage(
	image: ImageToolImage,
): Promise<ImageToolImage> {
	if (image.path || !image.b64_json) {
		return image;
	}
	const stored = await persistMediaPayload(
		{ kind: "base64", data: image.b64_json, mimeType: image.mime_type },
		{ kind: "image", folder: "generated" },
	);
	const { b64_json: _inline, ...rest } = image;
	return { ...rest, path: stored.path };
}

/** Read stored media back as bytes, retrying while the filesystem catches up. */
export async function readStoredMedia(path: string): Promise<Uint8Array> {
	const fs = await filesystem();
	return fs.readMediaFile(path);
}
