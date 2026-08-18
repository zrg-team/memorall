import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HtmlBlock } from "../components/html-block";

const HtmlBlockComponent = HtmlBlock.component as React.FC<{
	props: { html: string; height?: number; title?: string };
}>;

const renderHtml = (props: {
	html: string;
	height?: number;
	title?: string;
}) => {
	const { container } = render(<HtmlBlockComponent props={props} />);
	const frame = container.querySelector("iframe");
	if (!frame) throw new Error("expected an iframe");
	return frame;
};

describe("HtmlBlock", () => {
	it("runs scripts without handing the frame this page's origin", () => {
		const frame = renderHtml({ html: "<p>hi</p>" });

		// allow-scripts alone gives an opaque origin. Adding allow-same-origin
		// would let the framed document reach parent and strip its own sandbox,
		// so model-authored JS would inherit extension privileges.
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
	});

	it("does not let rendered output navigate or submit anywhere", () => {
		const sandbox = renderHtml({ html: "<p>hi</p>" }).getAttribute("sandbox");

		expect(sandbox).not.toContain("allow-same-origin");
		expect(sandbox).not.toContain("allow-popups");
		expect(sandbox).not.toContain("allow-forms");
		expect(sandbox).not.toContain("allow-top-navigation");
	});

	it("passes the document through as-is", () => {
		const html = "<h1>Report</h1><script>document.title='x'</script>";
		expect(renderHtml({ html }).getAttribute("srcdoc")).toBe(html);
	});

	it("clamps a height that would push the rest of the answer off-screen", () => {
		expect(renderHtml({ html: "<p/>", height: 10000 }).style.height).toBe(
			"900px",
		);
		expect(renderHtml({ html: "<p/>", height: 1 }).style.height).toBe("80px");
	});

	it("uses a readable default height when none is given", () => {
		expect(renderHtml({ html: "<p/>" }).style.height).toBe("320px");
	});

	it("labels the frame with the title, and falls back when absent", () => {
		expect(renderHtml({ html: "<p/>", title: "Sales" }).title).toBe("Sales");
		expect(renderHtml({ html: "<p/>" }).title).toBe("Rendered HTML");
	});

	it("sends no referrer", () => {
		expect(renderHtml({ html: "<p/>" }).getAttribute("referrerpolicy")).toBe(
			"no-referrer",
		);
	});
});
