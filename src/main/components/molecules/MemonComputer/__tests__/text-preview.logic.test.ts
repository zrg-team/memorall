import { describe, expect, it } from "vitest";
import { parseDelimited, textPreviewKind } from "../text-preview";

describe("text previews", () => {
	it("renders Markdown, HTML, CSV and TSV; other text stays text", () => {
		expect(textPreviewKind("/notes/a.md")).toBe("markdown");
		expect(textPreviewKind("/site/INDEX.HTM")).toBe("html");
		expect(textPreviewKind("/data/table.csv")).toBe("csv");
		expect(textPreviewKind("/data/table.tsv")).toBe("tsv");
		expect(textPreviewKind("/code/app.js")).toBeNull();
		expect(textPreviewKind(null)).toBeNull();
	});

	it("parses quoted cells with delimiters, quotes and line breaks", () => {
		expect(
			parseDelimited(
				'name,note\r\n"Smith, J","said ""hi""\nthen left"\nLee,\n',
				",",
			),
		).toEqual([
			["name", "note"],
			["Smith, J", 'said "hi"\nthen left'],
			["Lee", ""],
		]);
		expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
		expect(parseDelimited("", ",")).toEqual([]);
	});
});
