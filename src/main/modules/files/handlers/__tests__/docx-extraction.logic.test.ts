import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { docxToMarkdown } from "../docx-extraction";

const paragraph = (text: string, style?: string, list = false) =>
	`<w:p w:rsidR="1">${
		style || list
			? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${list ? '<w:numPr><w:ilvl w:val="0"/></w:numPr>' : ""}</w:pPr>`
			: ""
	}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;

const docx = (body: string): Uint8Array =>
	zipSync({
		"[Content_Types].xml": strToU8("<Types/>"),
		"word/document.xml": strToU8(
			`<?xml version="1.0"?><w:document><w:body>${body}<w:sectPr/></w:body></w:document>`,
		),
	});

describe("docxToMarkdown", () => {
	it("keeps headings, paragraphs, lists and tables in order", () => {
		const markdown = docxToMarkdown(
			docx(
				[
					paragraph("Quarterly report", "Title"),
					paragraph("Summary", "Heading2"),
					paragraph("Sales &amp; growth were &lt;strong&gt;."),
					paragraph("First point", undefined, true),
					paragraph("Second point", "ListParagraph"),
					"<w:p/>",
					`<w:tbl><w:tr>${cell("Region")}${cell("Revenue")}</w:tr><w:tr>${cell("EU | West")}${cell("1.2M")}</w:tr></w:tbl>`,
					`<w:p><w:r><w:t>Tab</w:t><w:tab/><w:t>after</w:t><w:br/><w:t>next line</w:t></w:r></w:p>`,
				].join(""),
			),
		);
		expect(markdown).toBe(
			[
				"# Quarterly report",
				"## Summary",
				"Sales & growth were <strong>.",
				"- First point\n- Second point",
				"| Region | Revenue |\n| --- | --- |\n| EU \\| West | 1.2M |",
				"Tab\tafter\nnext line",
			].join("\n\n"),
		);
	});

	it("refuses files that are not Word documents", () => {
		expect(() => docxToMarkdown(strToU8("plain text"))).toThrow(
			"This is not a Word document (.docx).",
		);
		expect(() =>
			docxToMarkdown(zipSync({ "other.xml": strToU8("<x/>") })),
		).toThrow("This is not a Word document (.docx).");
	});
});
