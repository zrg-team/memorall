// Pure helpers that shape ASR pipeline output into the OpenAI transcription
// response. Covered by `media-runner-helpers.logic.test.ts`.

const roundSeconds = (value) => Math.round(value * 100) / 100;

const finiteOrNull = (value) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Pipeline `chunks` (`{ timestamp: [start, end | null], text }`) to OpenAI
 * segments. The final chunk's end is `null` when the audio ran out mid-phrase,
 * so it ends at the audio's duration.
 *
 * @param {{ timestamp?: [number | null, number | null], text?: string }[] | undefined} chunks
 * @param {number} [duration] Seconds.
 * @returns {{ id: number, start: number, end: number, text: string }[]}
 */
export function buildSegments(chunks, duration) {
	if (!Array.isArray(chunks)) return [];
	const total = finiteOrNull(duration);
	const segments = [];
	let previousEnd = 0;
	for (const chunk of chunks) {
		const text = typeof chunk?.text === "string" ? chunk.text.trim() : "";
		const [rawStart, rawEnd] = Array.isArray(chunk?.timestamp)
			? chunk.timestamp
			: [];
		const start = finiteOrNull(rawStart) ?? previousEnd;
		let end = finiteOrNull(rawEnd) ?? total ?? start;
		if (end < start) end = start;
		previousEnd = end;
		if (!text) continue;
		segments.push({
			id: segments.length,
			start: roundSeconds(start),
			end: roundSeconds(end),
			text,
		});
	}
	return segments;
}

/** Joins transcript pieces without doubling or dropping spaces. */
export function joinTranscriptParts(parts) {
	return parts
		.map((part) => String(part ?? "").trim())
		.filter(Boolean)
		.join(" ");
}

/**
 * The OpenAI transcription options mapped onto pipeline options. Timestamps
 * and long-form chunking are always asked for; pipelines that cannot honour an
 * option are retried with their defaults by the caller.
 *
 * @param {{ language?: string, task?: string }} input
 */
export function buildAsrOptions({ language, task }) {
	const options = {
		return_timestamps: true,
		chunk_length_s: 30,
		stride_length_s: 5,
	};
	const normalizedLanguage =
		typeof language === "string" ? language.trim().toLowerCase() : "";
	if (normalizedLanguage && normalizedLanguage !== "auto") {
		options.language = normalizedLanguage;
	}
	if (task === "transcribe" || task === "translate") {
		options.task = task;
	}
	return options;
}
