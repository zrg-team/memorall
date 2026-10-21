import { describe, expect, it } from "vitest";
import { cleanTranscriptText } from "../text";
import { exportTabTranscript } from "../export";
import type { TabTranscript } from "../types";

describe("readable transcript text", () => {
	it("removes complete and partial Whisper timestamp/control tokens without losing Vietnamese or ordinary markup", () => {
		expect(
			cleanTranscriptText(
				"<|startoftranscript|><|vi|><|0.00|>Xin chào <|5.00|> mọi người<|endoftext|>",
			),
		).toBe("Xin chào mọi người");
		expect(cleanTranscriptText("Some words <|5.")).toBe("Some words");
		expect(cleanTranscriptText("Use <div> and x < 5.")).toBe(
			"Use <div> and x < 5.",
		);
	});
	it("exports the full recording, source and notes with safe filenames and missing-audio markers", () => {
		const transcript: TabTranscript = {
			session: {
				id: "12345678-id",
				tabId: 7,
				title: "../../Video: clip?",
				url: "https://example.com",
				startedAt: 1,
				status: "complete",
				model: {
					modelId: "asr",
					serviceName: "transformer-media",
					provider: "transformer-media",
				},
				noteStyle: "notes",
				summary: "Key decision",
			},
			chunks: Array.from({ length: 30 }, (_, index) => ({
				id: String(index),
				index,
				startMs: index * 5000,
				endMs: (index + 1) * 5000,
				audioPath: "a.wav",
				status: "done",
				text: `<|0.00|>Words ${index}`,
			})),
		};
		transcript.chunks[10].status = "failed";
		const file = exportTabTranscript(transcript);
		expect(file.fileName).not.toMatch(/[\\/:?]/);
		expect(file.content).toContain("Words 0");
		expect(file.content).toContain("Words 29");
		expect(file.content).toContain("Key decision");
		expect(file.content).toContain("Untranscribed audio");
		expect(file.content).not.toContain("<|0.00|>");
	});
});
