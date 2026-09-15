import type { TranscriptionSegment } from "@/types/openai-media";
import type { StudioItem } from "@/types/studio";

/**
 * Pure helpers for reading a transcription item and turning it into files.
 *
 * Kept free of React and the DOM so the subtitle formats - where an off-by-one
 * millisecond or a missing blank line breaks every player - can be tested in
 * the node project.
 */

export interface TranscriptView {
	text: string;
	segments: TranscriptionSegment[];
	language?: string;
	audio?: {
		path: string;
		mimeType: string;
		durationMs?: number;
		name?: string;
	};
	/**
	 * The user edited the text after it was produced, so the segments no longer
	 * describe it. Exports and the timestamped view fall back to the text.
	 */
	edited: boolean;
}

const squash = (value: string) => value.replace(/\s+/g, "").toLowerCase();

/**
 * Edits only rewrite the transcript text part (segments are left untouched),
 * so an edit shows up as text that no longer matches its segments. Whitespace
 * is ignored because providers join segments with or without spaces.
 */
export const segmentsMatchText = (
	segments: TranscriptionSegment[],
	text: string,
): boolean =>
	squash(segments.map((segment) => segment.text).join("")) === squash(text);

export function readTranscript(
	item: Pick<StudioItem, "parts">,
): TranscriptView {
	let text = "";
	let segments: TranscriptionSegment[] = [];
	let language: string | undefined;
	let audio: TranscriptView["audio"];
	for (const part of item.parts) {
		if (part.type === "text" && part.role === "transcript") text = part.text;
		else if (part.type === "segments") {
			segments = part.segments;
			language = part.language;
		} else if (part.type === "input_audio") audio = part.input_audio;
	}
	const edited = segments.length > 0 && !segmentsMatchText(segments, text);
	return { text, segments, language, audio, edited };
}

/** Replace the transcript text, leaving the clip and segments as they were. */
export function withTranscriptText(
	parts: StudioItem["parts"],
	text: string,
): StudioItem["parts"] {
	let replaced = false;
	const next = parts.map((part) => {
		if (part.type === "text" && part.role === "transcript") {
			replaced = true;
			return { ...part, text };
		}
		return part;
	});
	return replaced
		? next
		: [...next, { type: "text", text, role: "transcript" }];
}

const pad = (value: number, length = 2) =>
	value.toString().padStart(length, "0");

/**
 * Split seconds into clock fields. Rounds to whole milliseconds *before*
 * splitting so 59.9996 s becomes 01:00.000 rather than 00:59.1000.
 */
const clockParts = (seconds: number) => {
	const totalMs = Math.max(
		0,
		Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000),
	);
	return {
		hours: Math.floor(totalMs / 3_600_000),
		minutes: Math.floor(totalMs / 60_000) % 60,
		seconds: Math.floor(totalMs / 1000) % 60,
		ms: totalMs % 1000,
	};
};

/** A compact clock for the UI: `m:ss`, or `h:mm:ss` past an hour. */
export function formatClock(seconds: number): string {
	const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor(whole / 60) % 60;
	const rest = whole % 60;
	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(rest)}`
		: `${pad(minutes)}:${pad(rest)}`;
}

/** `HH:MM:SS,mmm` - SRT requires a comma before the milliseconds. */
export function formatSrtTimestamp(seconds: number): string {
	const clock = clockParts(seconds);
	return `${pad(clock.hours)}:${pad(clock.minutes)}:${pad(clock.seconds)},${pad(clock.ms, 3)}`;
}

/** `HH:MM:SS.mmm` - WebVTT uses a full stop. */
export function formatVttTimestamp(seconds: number): string {
	const clock = clockParts(seconds);
	return `${pad(clock.hours)}:${pad(clock.minutes)}:${pad(clock.seconds)}.${pad(clock.ms, 3)}`;
}

interface CueSource {
	text: string;
	segments: TranscriptionSegment[];
	/** Clip length, used for the single cue of an unsegmented transcript. */
	durationMs?: number;
	edited?: boolean;
}

interface Cue {
	start: number;
	end: number;
	text: string;
}

/**
 * The cues to write. Blank segments are dropped (an SRT cue with no text ends
 * the file for some players), and a transcript without usable segments
 * becomes one cue spanning the clip.
 */
function cuesOf(source: CueSource): Cue[] {
	if (!source.edited) {
		const cues = source.segments
			.map((segment) => ({
				start: segment.start,
				end: Math.max(segment.start, segment.end),
				text: segment.text.trim(),
			}))
			.filter((cue) => cue.text.length > 0);
		if (cues.length > 0) return cues;
	}
	const text = source.text.trim();
	if (!text) return [];
	const end = source.durationMs ? source.durationMs / 1000 : 0;
	return [{ start: 0, end, text }];
}

export function toSrt(source: CueSource): string {
	return cuesOf(source)
		.map(
			(cue, index) =>
				`${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`,
		)
		.join("\n");
}

export function toVtt(source: CueSource): string {
	const body = cuesOf(source)
		.map(
			(cue) =>
				`${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}\n`,
		)
		.join("\n");
	return body ? `WEBVTT\n\n${body}` : "WEBVTT\n";
}

export function toTxt(source: Pick<CueSource, "text">): string {
	const text = source.text.trim();
	return text ? `${text}\n` : "";
}

export type TranscriptExportFormat = "txt" | "srt" | "vtt";

export const EXPORT_MIME_TYPES: Record<TranscriptExportFormat, string> = {
	txt: "text/plain;charset=utf-8",
	srt: "application/x-subrip;charset=utf-8",
	vtt: "text/vtt;charset=utf-8",
};

export function exportTranscript(
	source: CueSource,
	format: TranscriptExportFormat,
): string {
	if (format === "srt") return toSrt(source);
	if (format === "vtt") return toVtt(source);
	return toTxt(source);
}

/** A download name from the clip name: extension dropped, unsafe characters replaced. */
export function exportBaseName(
	name: string | undefined,
	fallback = "transcript",
): string {
	const base = (name ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
	const safe = base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
	return safe || fallback;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Index of the segment playing at `position`, or -1. */
export function activeSegmentIndex(
	segments: TranscriptionSegment[],
	position: number,
): number {
	for (let index = segments.length - 1; index >= 0; index--) {
		const segment = segments[index];
		if (segment && position >= segment.start) {
			return position < Math.max(segment.end, segment.start + 0.01)
				? index
				: -1;
		}
	}
	return -1;
}
