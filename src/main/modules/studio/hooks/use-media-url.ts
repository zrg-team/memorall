import { useEffect, useState } from "react";
import { readStoredMedia } from "@/services/llm/utils/media-persistence";

/**
 * Object URLs for stored media, shared by every consumer of the same path.
 *
 * A gallery re-renders often and the same clip can appear in several places;
 * reading and wrapping the file once keeps scrolling cheap. URLs are released
 * once the last user unmounts.
 */
const cache = new Map<string, { url: Promise<string>; users: number }>();

function acquire(path: string, mimeType: string): Promise<string> {
	const key = `${path}|${mimeType}`;
	const entry = cache.get(key);
	if (entry) {
		entry.users++;
		return entry.url;
	}
	const url = readStoredMedia(path).then((bytes) =>
		URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType })),
	);
	url.catch(() => cache.delete(key));
	cache.set(key, { url, users: 1 });
	return url;
}

function release(path: string, mimeType: string): void {
	const key = `${path}|${mimeType}`;
	const entry = cache.get(key);
	if (!entry) return;
	entry.users--;
	if (entry.users > 0) return;
	cache.delete(key);
	void entry.url.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
}

export function useMediaUrl(path: string | undefined, mimeType: string) {
	const [url, setUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!path) {
			setUrl(null);
			return;
		}
		let active = true;
		setError(null);
		acquire(path, mimeType)
			.then((value) => {
				if (active) setUrl(value);
			})
			.catch((reason) => {
				if (active) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			});
		return () => {
			active = false;
			release(path, mimeType);
		};
	}, [path, mimeType]);

	return { url, error };
}
