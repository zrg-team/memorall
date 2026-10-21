import { describe, expect, it } from "vitest";
import { transcriptParagraphs } from "../paragraphs";
import type { TranscriptChunkPreview } from "../types";

const chunk = (
	index: number,
	text: string,
	overrides: Partial<TranscriptChunkPreview> = {},
): TranscriptChunkPreview => ({
	id: `chunk-${index}`,
	index,
	startMs: index * 5000,
	endMs: (index + 1) * 5000,
	status: "done",
	text,
	...overrides,
});
const text = (chunks: TranscriptChunkPreview[]) =>
	transcriptParagraphs(chunks).map((paragraph) =>
		paragraph.parts.map((part) => part.separator + part.chunk.text).join(""),
	);

describe("continuous transcript paragraphs", () => {
	it("keeps a sentence flowing across save windows with a single timestamp", () => {
		const chunks = [
			chunk(0, "Coming from a MacBook, I"),
			chunk(1, "expect certain things."),
			chunk(2, "The keyboard feels solid."),
		];
		expect(text(chunks)).toEqual([
			"Coming from a MacBook, I expect certain things. The keyboard feels solid.",
		]);
		expect(transcriptParagraphs(chunks)[0]).toMatchObject({
			id: "chunk-0",
			startMs: 0,
			endMs: 15000,
		});
	});
	it("uses completed sentences for readable paragraph breaks, never the new partial's punctuation", () => {
		const chunks = [
			chunk(0, "a".repeat(300)),
			chunk(1, "still speaking", { status: "pending" }),
		];
		expect(transcriptParagraphs(chunks)).toHaveLength(1);
		chunks[1] = chunk(1, "still speaking.", { status: "done" });
		chunks.push(chunk(2, "Next thought", { status: "pending" }));
		const paragraphs = transcriptParagraphs(chunks);
		expect(paragraphs).toHaveLength(2);
		expect(paragraphs[0].id).toBe("chunk-0");
		expect(paragraphs[1].parts[0].chunk.id).toBe("chunk-2");
	});
	it("preserves Vietnamese, punctuation and Chinese or Japanese joins without rewriting words", () => {
		expect(
			text([
				chunk(0, "Xin chào"),
				chunk(1, "mọi người."),
				chunk(2, "Đây là nội dung gốc."),
			]),
		).toEqual(["Xin chào mọi người. Đây là nội dung gốc."]);
		expect(
			text([chunk(0, "你好"), chunk(1, "世界。"), chunk(2, "次の話です。")]),
		).toEqual(["你好世界。次の話です。"]);
		expect(text([chunk(0, "Hello"), chunk(1, ", world.")])).toEqual([
			"Hello, world.",
		]);
	});
	it("does not join across silence, missing windows or failed audio", () => {
		for (const status of ["done", "pending", "failed"] as const) {
			const paragraphs = transcriptParagraphs([
				chunk(0, "Before"),
				chunk(1, "", { status }),
				chunk(2, "After"),
			]);
			expect(paragraphs.at(-1)?.id).toBe("chunk-2");
			expect(paragraphs).toHaveLength(status === "failed" ? 3 : 2);
		}
		expect(
			transcriptParagraphs([chunk(0, "Before"), chunk(2, "After")]),
		).toHaveLength(2);
		expect(
			transcriptParagraphs([
				chunk(0, "Before"),
				chunk(1, "After", { startMs: 7000 }),
			]),
		).toHaveLength(2);
	});
	it("bounds long unpunctuated speech and preserves every source character", () => {
		const chunks = Array.from({ length: 20 }, (_, index) =>
			chunk(index, "word ".repeat(20).trim()),
		);
		const paragraphs = transcriptParagraphs(chunks);
		expect(paragraphs.length).toBeGreaterThan(1);
		expect(
			paragraphs.flatMap((paragraph) =>
				paragraph.parts.map((part) => part.chunk),
			),
		).toEqual(chunks);
	});
});
