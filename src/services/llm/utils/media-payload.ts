import type { MediaPayload } from "@/types/openai-media";
import { base64ToBytes, bytesToBase64 } from "./media-encoding";

/**
 * Resolve any media payload to raw bytes in the current context.
 *
 * The filesystem is imported lazily: this module is reachable from the model
 * picker, and the documents service drags pdf.js and ZenFS with it.
 */
export async function mediaPayloadToBytes(
	payload: MediaPayload,
): Promise<Uint8Array> {
	switch (payload.kind) {
		case "bytes":
			return payload.bytes;
		case "base64":
			return base64ToBytes(payload.data);
		case "file": {
			// Retries: the file may have been written by another context a moment
			// ago (the UI saving a recording for the offscreen runner).
			const { documentFileSystemService } = await import(
				"@/services/filesystem/document-filesystem"
			);
			return documentFileSystemService.readMediaFile(payload.path);
		}
	}
}

/** Make a payload safe to put on a background job (JSON only). */
export async function toSerializableMediaPayload(
	payload: MediaPayload,
): Promise<Exclude<MediaPayload, { kind: "bytes" }>> {
	if (payload.kind !== "bytes") {
		return payload;
	}
	return {
		kind: "base64",
		data: bytesToBase64(payload.bytes),
		mimeType: payload.mimeType,
	};
}

export function mediaPayloadMimeType(payload: MediaPayload): string {
	return payload.mimeType;
}
