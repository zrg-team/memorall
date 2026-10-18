import { describe, expect, it } from "vitest";
import {
	parseOCRLayout,
	validateOCRFile,
	MAX_OCR_UPLOAD_BYTES,
} from "../ocr-document";

describe("OCR layout", () => {
	it("extracts page coordinates while keeping text and table content", () => {
		const result = parseOCRLayout(
			"![title](80,70,920,140)\n# Report\n\n![table+](10, 200, 990, 900)\n| A | B |\n|---|---|\n| 1 | 2 |",
		);
		expect(result.blocks).toEqual([
			{
				label: "title",
				content: "# Report",
				x: 80,
				y: 70,
				width: 840,
				height: 70,
			},
			{
				label: "table+",
				content: "| A | B |\n|---|---|\n| 1 | 2 |",
				x: 10,
				y: 200,
				width: 980,
				height: 700,
			},
		]);
		expect(result.markdown).toContain("# Report");
		expect(result.markdown).toContain("| 1 | 2 |");
		expect(result.markdown).not.toContain("![title]");
	});
	it("preserves reading order, prefix text and decimal coordinates", () => {
		const result = parseOCRLayout(
			"Introduction\n![HEADER_IMAGE](2.5,0,98.5,12)\nLogo\n![text](100,20,900,45)\nParagraph",
		);
		expect(result.markdown).toBe("Introduction\n\nLogo\n\nParagraph");
		expect(result.blocks).toEqual([
			{
				label: "header_image",
				content: "Logo",
				x: 2.5,
				y: 0,
				width: 96,
				height: 12,
			},
			{
				label: "text",
				content: "Paragraph",
				x: 100,
				y: 20,
				width: 800,
				height: 25,
			},
		]);
	});
	it("ignores inverted, empty and out-of-page boxes and leaves normal Markdown untouched", () => {
		const text =
			"![text](90,10,80,100)\n![text](10,20,10,30)\n![text](0,0,1001,20)\n![image](https://example.com/a.png)\n# Hello";
		expect(parseOCRLayout(text)).toEqual({ markdown: text, blocks: [] });
	});
});

describe("OCR uploads", () => {
	it("accepts supported images and PDFs, including files without MIME metadata", () => {
		for (const name of [
			"report.PDF",
			"scan.png",
			"scan.jpeg",
			"scan.jpg",
			"scan.webp",
		]) {
			expect(() =>
				validateOCRFile({ name, size: 100, type: "" } as File),
			).not.toThrow();
		}
	});
	it.each([
		[{ name: "empty.pdf", size: 0, type: "application/pdf" }, "empty"],
		[
			{
				name: "large.pdf",
				size: MAX_OCR_UPLOAD_BYTES + 1,
				type: "application/pdf",
			},
			"50 MB",
		],
		[{ name: "script.svg", size: 100, type: "image/svg+xml" }, "PDF, PNG"],
	])("rejects an invalid input", (file, message) => {
		expect(() => validateOCRFile(file as File)).toThrow(message as string);
	});
});
