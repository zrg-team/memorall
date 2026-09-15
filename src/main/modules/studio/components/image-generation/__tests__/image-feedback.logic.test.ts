import { describe, expect, it } from "vitest";
import type { ImageComment, StudioItem } from "@/types/studio";
import {
	basePromptOf,
	commentsOf,
	composeFeedbackPrompt,
	describeRegion,
	regionBetween,
	withComments,
} from "../image-feedback";

const comment = (
	text: string,
	region?: ImageComment["region"],
): ImageComment => ({
	id: text,
	text,
	region,
	createdAt: 0,
});

describe("image feedback", () => {
	it("turns a drag in any direction into a region inside the image", () => {
		expect(regionBetween({ x: 0.6, y: 0.8 }, { x: 0.2, y: 1.4 })).toEqual({
			x: 0.2,
			y: 0.8,
			width: expect.closeTo(0.4),
			height: expect.closeTo(0.2),
		});
		// A click is not a selection.
		expect(regionBetween({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.6 })).toBeNull();
	});

	it("numbers every note and places regions in words", () => {
		const prompt = composeFeedbackPrompt(
			"A red fox",
			[
				comment("Bigger ears", { x: 0.1, y: 0.2, width: 0.3, height: 0.25 }),
				comment("Warmer light"),
			],
			{ markedCopy: true },
		);
		expect(prompt).toContain("Original prompt: A red fox");
		expect(prompt).toContain(
			"1. (area 1, from 10% to 40% across, 20% to 45% down) Bigger ears",
		);
		expect(prompt).toContain("2. (whole image) Warmer light");
		expect(prompt).toContain("do not draw the outlines or numbers");
		expect(
			composeFeedbackPrompt("x", [comment("y")], { markedCopy: false }),
		).not.toContain("second image");
		expect(describeRegion({ x: 0, y: 0, width: 1, height: 1 })).toBe(
			"from 0% to 100% across, 0% to 100% down",
		);
	});

	it("keeps comments per image and follows a chain back to its first prompt", () => {
		const item = {
			content: "Composed follow-up prompt",
			parts: [
				{
					type: "image_feedback",
					feedback: {
						basePrompt: "A red fox",
						source: { path: "a.png", mimeType: "image/png", itemId: "a" },
						comments: [],
					},
				},
			],
		} as unknown as StudioItem;
		const parts = withComments(item.parts, "b.png", [comment("Night")]);
		expect(commentsOf({ ...item, parts }, "b.png")).toEqual([comment("Night")]);
		expect(commentsOf({ ...item, parts }, "a.png")).toEqual([]);
		expect(withComments(parts, "b.png", [])).toEqual(item.parts);
		expect(basePromptOf(item)).toBe("A red fox");
	});
});
