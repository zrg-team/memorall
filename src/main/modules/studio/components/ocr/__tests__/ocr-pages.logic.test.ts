import { describe, expect, it } from "vitest";
import { parseOCRPages, resolveOCRPages } from "../ocr-pages";

describe("PDF page selection", () => {
	it("merges ranges, sorts document order and deduplicates selected pages", () => {
		expect(parseOCRPages("8, 3-5, 1, 4, 6–7", 10)).toEqual([
			1, 3, 4, 5, 6, 7, 8,
		]);
	});
	it.each([
		"",
		"1,",
		"1 3",
		"all",
		"0",
		"11",
		"3-2",
		"1-11",
		"1.5",
		"-1",
		"9007199254740992",
	])("rejects invalid selections: %s", (value) => {
		expect(() => parseOCRPages(value, 10)).toThrow();
	});
	it("resolves current, all and custom selections independently", () => {
		expect(resolveOCRPages("current", 2, 3, "bad")).toEqual([2]);
		expect(resolveOCRPages("all", 2, 3, "bad")).toEqual([1, 2, 3]);
		expect(resolveOCRPages("custom", 2, 3, "1,3")).toEqual([1, 3]);
	});
});
