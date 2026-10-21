import type { TranscriptChunkPreview } from "./types";

export interface TranscriptParagraph {
	id: string;
	startMs: number;
	endMs: number;
	parts: { chunk: TranscriptChunkPreview; separator: string }[];
}

const endsSentence = /[.!?。！？…]["'”’»）)\]]*$/u;
const ideographicEnd =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}。！？、]$/u;
const ideographicStart =
	/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function separator(previous: string, next: string): string {
	if (/^[,.;:!?，。！？、；：)\]）]/u.test(next)) return "";
	if (ideographicEnd.test(previous) && ideographicStart.test(next)) return "";
	return " ";
}

/** Reading boundaries are independent of the recorder's five-second save windows.
 * Only completed text can close a paragraph, so partial tokens don't move older
 * words between paragraphs. Source text and per-window timing stay intact.
 */
export function transcriptParagraphs(
	chunks: readonly TranscriptChunkPreview[],
): TranscriptParagraph[] {
	const result: TranscriptParagraph[] = [];
	let current: TranscriptParagraph | undefined;
	let previous: TranscriptChunkPreview | undefined;
	let length = 0;
	for (const chunk of chunks) {
		if (!chunk.text && chunk.status !== "failed") {
			// Silence or unresolved audio must not connect unrelated speech.
			current = undefined;
			previous = chunk;
			continue;
		}
		const elapsed = current ? chunk.startMs - current.startMs : 0;
		const boundary =
			!current ||
			!previous ||
			previous.status !== "done" ||
			chunk.status === "failed" ||
			chunk.index !== previous.index + 1 ||
			chunk.startMs - previous.endMs >= 1200 ||
			// Prefer a completed sentence after a comfortable amount of text.
			(endsSentence.test(previous.text) &&
				(length >= 280 || elapsed >= 20000)) ||
			// Bound unpunctuated output too; this is a reading heuristic, not VAD.
			length >= 700 ||
			elapsed >= 45000;
		if (boundary) {
			current = {
				id: chunk.id,
				startMs: chunk.startMs,
				endMs: chunk.endMs,
				parts: [],
			};
			result.push(current);
			length = 0;
		}
		const join = current!.parts.length
			? separator(previous!.text, chunk.text)
			: "";
		current!.parts.push({ chunk, separator: join });
		current!.endMs = chunk.endMs;
		length += join.length + chunk.text.length;
		previous = chunk;
	}
	return result;
}
