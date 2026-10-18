import { describe, expect, it } from "vitest";
import type { StudioItem } from "@/types/studio";
import { ocrResultData } from "../ocr-data";
import { buildOCRFile } from "../ocr-file";

function item(pageNumber: number, batchId = "batch-1"): StudioItem {
	return {
		id: `${batchId}-${pageNumber}`,
		conversationId: "session-1",
		category: "ocr",
		content: "report.pdf",
		createdAt: new Date(),
		parts: [
			{
				type: "text",
				role: "transcript",
				text: `![title](10,20,900,100)\n# Page ${pageNumber}`,
			},
		],
		generation: {
			category: "ocr",
			modelId: "org/future-ocr",
			provider: "transformer-media",
			serviceName: "transformer-media",
			status: "done",
			params: { pageNumber, pageCount: 5, selectedPages: [1, 3], batchId },
		},
	};
}

describe("OCR file conversion", () => {
	it("exports only the selected conversion, preserving page order and provenance", () => {
		const selected = item(3);
		const data = ocrResultData(
			[
				selected,
				item(1, "other-run"),
				item(1),
				{ ...item(2), conversationId: "another-session" },
			],
			selected,
		)!;
		expect(data.pages.map((page) => page.pageNumber)).toEqual([1, 3]);
		const file = buildOCRFile(data, "json");
		expect(file.fileName).toBe("report-data.json");
		expect(JSON.parse(file.content)).toMatchObject({
			version: 1,
			totalPages: 5,
			selectedPages: [1, 3],
			pages: [
				{
					pageNumber: 1,
					status: "done",
					model: { id: "org/future-ocr", provider: "transformer-media" },
					layout: [
						{
							label: "title",
							content: "# Page 1",
							x: 10,
							y: 20,
							width: 890,
							height: 80,
						},
					],
				},
				{ pageNumber: 3, status: "done" },
			],
		});
	});
	it("preserves failures and requested pages without claiming missing pages completed", () => {
		const selected = item(1);
		const failed = {
			...item(3),
			parts: [],
			generation: {
				...item(3).generation,
				status: "failed" as const,
				error: "Model stopped",
			},
		};
		const data = ocrResultData([selected, failed], selected)!;
		expect(data.pages[1]).toMatchObject({
			status: "failed",
			error: "Model stopped",
			markdown: "",
		});
		expect(buildOCRFile(data, "markdown").content).toContain(
			"[failed: Model stopped]",
		);
		expect(ocrResultData([], undefined)).toBeNull();
		const legacy = {
			...selected,
			generation: { ...selected.generation, params: { pageNumber: 1 } },
		};
		expect(ocrResultData([legacy, item(3)], legacy)?.pages).toHaveLength(1);
	});
	it("creates readable Markdown for all selected pages without layout markers", () => {
		const first = item(1);
		const file = buildOCRFile(
			ocrResultData([item(3), first], first)!,
			"markdown",
		);
		expect(file.fileName).toBe("report-pages.md");
		expect(file.content).toBe(
			"# Page 1\n\n# Page 1\n\n---\n\n# Page 3\n\n# Page 3",
		);
		expect(file.content).not.toContain("![title]");
	});
	it("creates offline HTML with document structure and safely escaped source text", () => {
		const selected = item(1);
		selected.content = '<script>alert("name")</script>.pdf';
		selected.parts = [
			{
				type: "text",
				role: "transcript",
				text: '# Report\n\n<table style="position:fixed"><tr><td>Total</td><td>12</td></tr></table><script>alert(1)</script><img src="https://example.com/track" />',
			},
		];
		const file = buildOCRFile(ocrResultData([selected], selected)!, "html");
		const doc = new DOMParser().parseFromString(file.content, "text/html");
		expect(doc.querySelector("h1")?.textContent).toBe("Report");
		expect(doc.querySelector("table")?.textContent).toBe("Total12");
		expect(
			doc.querySelector("script, img, iframe, link, [style], [href], [src]"),
		).toBeNull();
		expect(doc.querySelector("title")?.textContent).toBe(selected.content);
	});
});
