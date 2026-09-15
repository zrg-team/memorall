import { describe, expect, it } from "vitest";
import type { StudioContentPart } from "@/types/studio";
import {
	activeSegmentIndex,
	exportBaseName,
	formatClock,
	formatSrtTimestamp,
	formatVttTimestamp,
	readTranscript,
	toSrt,
	toTxt,
	toVtt,
	withTranscriptText,
} from "../transcript-format";

const segments = [
	{ id: 0, start: 0, end: 2.5, text: " Hello there." },
	{ id: 1, start: 2.5, end: 5.0004, text: " " },
	{ id: 2, start: 5.25, end: 3725.1239, text: " General Kenobi." },
];

describe("subtitle timestamps", () => {
	it("pads every field and separates milliseconds per format", () => {
		expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
		expect(formatVttTimestamp(0)).toBe("00:00:00.000");
		expect(formatSrtTimestamp(61.5)).toBe("00:01:01,500");
		expect(formatVttTimestamp(61.5)).toBe("00:01:01.500");
	});

	it("carries hours past sixty minutes", () => {
		expect(formatSrtTimestamp(3725.123)).toBe("01:02:05,123");
		expect(formatVttTimestamp(36_000)).toBe("10:00:00.000");
	});

	it("rounds to the millisecond before splitting fields", () => {
		expect(formatSrtTimestamp(59.9996)).toBe("00:01:00,000");
		expect(formatSrtTimestamp(1.0004)).toBe("00:00:01,000");
		expect(formatVttTimestamp(2.0625)).toBe("00:00:02.063");
	});

	it("clamps negative and non-finite times to zero", () => {
		expect(formatSrtTimestamp(-3)).toBe("00:00:00,000");
		expect(formatVttTimestamp(Number.NaN)).toBe("00:00:00.000");
	});

	it("formats a short clock for the UI", () => {
		expect(formatClock(12.9)).toBe("00:12");
		expect(formatClock(605)).toBe("10:05");
		expect(formatClock(3725)).toBe("1:02:05");
	});
});

describe("toSrt", () => {
	it("numbers cues from 1, skips blank segments and separates cues with a blank line", () => {
		expect(toSrt({ text: "Hello there. General Kenobi.", segments })).toBe(
			"1\n00:00:00,000 --> 00:00:02,500\nHello there.\n\n" +
				"2\n00:00:05,250 --> 01:02:05,124\nGeneral Kenobi.\n",
		);
	});

	it("writes one cue spanning the clip when there are no segments", () => {
		expect(toSrt({ text: " Just text ", segments: [], durationMs: 4200 })).toBe(
			"1\n00:00:00,000 --> 00:00:04,200\nJust text\n",
		);
	});

	it("uses the edited text instead of stale segments", () => {
		expect(
			toSrt({
				text: "Fixed wording",
				segments,
				durationMs: 1000,
				edited: true,
			}),
		).toBe("1\n00:00:00,000 --> 00:00:01,000\nFixed wording\n");
	});

	it("is empty when there is nothing to say", () => {
		expect(toSrt({ text: "  ", segments: [] })).toBe("");
	});
});

describe("toVtt", () => {
	it("starts with the WEBVTT header and uses full-stop milliseconds", () => {
		expect(toVtt({ text: "", segments: segments.slice(0, 1) })).toBe(
			"WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello there.\n",
		);
	});

	it("keeps a valid header for an empty transcript", () => {
		expect(toVtt({ text: "", segments: [] })).toBe("WEBVTT\n");
	});
});

describe("toTxt", () => {
	it("trims and ends with a newline", () => {
		expect(toTxt({ text: "  Line one\nLine two  " })).toBe(
			"Line one\nLine two\n",
		);
		expect(toTxt({ text: "   " })).toBe("");
	});
});

describe("reading a transcription item", () => {
	const parts: StudioContentPart[] = [
		{
			type: "input_audio",
			input_audio: {
				path: "recordings/a.webm",
				mimeType: "audio/webm",
				name: "a.webm",
			},
		},
		{ type: "text", role: "transcript", text: "Hello there. General Kenobi." },
		{ type: "segments", segments, language: "en" },
	];

	it("collects text, segments, language and clip", () => {
		const view = readTranscript({ parts });
		expect(view.text).toBe("Hello there. General Kenobi.");
		expect(view.segments).toHaveLength(3);
		expect(view.language).toBe("en");
		expect(view.audio?.path).toBe("recordings/a.webm");
		expect(view.edited).toBe(false);
	});

	it("detects an edit when the text no longer matches the segments", () => {
		const edited = withTranscriptText(parts, "Hello there, General Kenobi!");
		expect(readTranscript({ parts: edited }).edited).toBe(true);
		// The clip and segments are left alone.
		expect(edited[0]).toBe(parts[0]);
		expect(edited[2]).toBe(parts[2]);
	});

	it("finds the segment under the playhead", () => {
		expect(activeSegmentIndex(segments, 1)).toBe(0);
		expect(activeSegmentIndex(segments, 5.1)).toBe(-1);
		expect(activeSegmentIndex(segments, 6)).toBe(2);
	});

	it("derives a safe export name", () => {
		expect(exportBaseName("meeting: notes.mp3")).toBe("meeting- notes");
		expect(exportBaseName(undefined)).toBe("transcript");
	});
});
