import { describe, expect, it } from "vitest";
import {
	extractToolResult,
	toolMessageContentImages,
	toolMessageContentToText,
} from "../interfaces/engine/tool.js";
import { collapseReadableWhitespace } from "../tools/web/web-tool-utils.js";

const imagePart = (url: string) =>
	({ type: "image_url", image_url: { url } }) as never;
const textPart = (text: string) => ({ type: "text", text }) as never;

describe("toolMessageContentToText", () => {
	it("names the images instead of printing 'undefined' for each", () => {
		// Every image part used to be mapped through `.text`, so a tool that
		// answered with pictures wrote "undefined" once per picture.
		const text = toolMessageContentToText([
			textPart("Inspect 2 images:"),
			imagePart("data:image/png;base64,AAA"),
			imagePart("data:image/png;base64,BBB"),
		]);

		expect(text).not.toContain("undefined");
		expect(text).toContain("Inspect 2 images:");
		expect(text).toContain("[2 images attached]");
	});

	it("says one image in the singular", () => {
		expect(
			toolMessageContentToText([imagePart("data:image/png;base64,AAA")]),
		).toContain("[1 image attached]");
	});

	it("leaves a plain string result alone", () => {
		expect(toolMessageContentToText("done")).toBe("done");
	});
});

describe("toolMessageContentImages", () => {
	it("collects the image urls so the UI can show them", () => {
		expect(
			toolMessageContentImages([
				textPart("here"),
				imagePart("data:image/png;base64,AAA"),
			]),
		).toEqual(["data:image/png;base64,AAA"]);
	});

	it("finds none in a text-only result", () => {
		expect(toolMessageContentImages("done")).toEqual([]);
	});
});

describe("extractToolResult", () => {
	it("carries image urls separately from the readable text", () => {
		const result = extractToolResult([
			textPart("Inspect 1 image:"),
			imagePart("data:image/png;base64,AAA"),
		] as never);

		expect(result.imageUrls).toEqual(["data:image/png;base64,AAA"]);
		expect(result.contentText).toContain("[1 image attached]");
	});
});

describe("collapseReadableWhitespace", () => {
	it("spends the read budget on words rather than indentation", () => {
		const indented =
			"\n\n\n        Price        9.79 ty\n\n\n\n   69 m2   \n\n";
		// The blank-line run between them is a paragraph break, so it survives
		// as one blank line while the indentation does not.
		expect(collapseReadableWhitespace(indented)).toBe("Price 9.79 ty\n\n69 m2");
	});

	it("keeps one blank line so paragraphs survive", () => {
		expect(collapseReadableWhitespace("a\n\n\n\n\nb")).toBe("a\n\nb");
	});

	it("normalises Windows line endings", () => {
		expect(collapseReadableWhitespace("a\r\nb")).toBe("a\nb");
	});
});
