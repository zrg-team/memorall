import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	actOnRef,
	buildPageOutline,
	formatPageOutline,
	StaleOutlineError,
} from "../page-outline";

// jsdom has no layout: every element reports no boxes, which the outline
// reads as "not rendered". Give everything a box so visibility checks pass.
const stubLayout = () => {
	vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
		() => [{ width: 10, height: 10 }] as unknown as DOMRectList,
	);
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
		() =>
			({
				top: 0,
				left: 0,
				right: 100,
				bottom: 20,
				width: 100,
				height: 40,
				x: 0,
				y: 0,
			}) as DOMRect,
	);
};

describe("page outline", () => {
	beforeEach(() => {
		stubLayout();
		document.title = "Evals";
		document.body.innerHTML = `
			<nav><a href="/home">Home</a></nav>
			<h1>Grade the trajectory</h1>
			<p>Most evals check only the final answer.</p>
			<img src="https://example.com/figure.png" alt="Figure 1">
			<ul><li>Right tool</li><li>Valid arguments</li></ul>
			<form method="get" action="/search"><input name="q" placeholder="Search"><button>Go</button></form>
			<form method="post" action="/subscribe"><button>Subscribe</button></form>
			<input type="password" name="password" value="secret">
			<p hidden>Hidden text</p>
		`;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("lists headings, text and refs for controls and images", () => {
		const outline = buildPageOutline(document);
		const text = formatPageOutline(outline);

		expect(outline.title).toBe("Evals");
		expect(text).toContain("# Grade the trajectory");
		expect(text).toContain("Most evals check only the final answer.");
		expect(text).toMatch(/\[b\d+\] link "Home"/);
		expect(text).toMatch(/\[b\d+\] img 100×40 "Figure 1"/);
		expect(text).toContain("- Right tool\n- Valid arguments");
		expect(text).toMatch(/\[b\d+\] input "q" placeholder="Search"/);
		expect(text).toMatch(/\[b\d+\] button "Subscribe" \(submits a form\)/);
		expect(text).not.toContain("Hidden text");
		// A password field is listed but never shows its value.
		expect(text).not.toContain("secret");
	});

	it("keeps refs stable across reads of the same document", () => {
		const first = buildPageOutline(document);
		const second = buildPageOutline(document);
		expect(second.docToken).toBe(first.docToken);
		expect(formatPageOutline(second)).toBe(formatPageOutline(first));
	});

	it("types into a field and dispatches input and change events", () => {
		const outline = buildPageOutline(document);
		const input = outline.blocks.find((block) => block.kind === "input");
		if (!input || input.kind !== "input") throw new Error("no input");
		const field = document.querySelector("input[name=q]") as HTMLInputElement;
		const events: string[] = [];
		field.addEventListener("input", () => events.push("input"));
		field.addEventListener("change", () => events.push("change"));

		const result = actOnRef(document, {
			ref: input.ref,
			docToken: outline.docToken,
			action: "input",
			value: "agent quality",
		});

		expect(result.ok).toBe(true);
		expect(field.value).toBe("agent quality");
		expect(events).toEqual(["input", "change"]);
	});

	it("asks for approval before a click submits a POST form", () => {
		const outline = buildPageOutline(document);
		const subscribe = outline.blocks.find(
			(block) => block.kind === "button" && block.text === "Subscribe",
		);
		if (!subscribe || subscribe.kind !== "button") throw new Error("no button");
		const submit = vi.fn((event: Event) => event.preventDefault());
		document.forms[1].addEventListener("submit", submit);

		const gated = actOnRef(document, {
			ref: subscribe.ref,
			docToken: outline.docToken,
			action: "click",
		});
		expect(gated).toMatchObject({ ok: false, needsApproval: "form-submit" });
		expect(submit).not.toHaveBeenCalled();
	});

	it("rejects a ref read from another document as a stale screen", () => {
		const outline = buildPageOutline(document);
		const link = outline.blocks.find((block) => block.kind === "link");
		if (!link || link.kind !== "link") throw new Error("no link");

		expect(() =>
			actOnRef(document, {
				ref: link.ref,
				docToken: "d-some-other-page",
				action: "click",
			}),
		).toThrow(StaleOutlineError);
	});

	it("refuses sensitive fields", () => {
		const outline = buildPageOutline(document);
		const password = outline.blocks.find(
			(block) => block.kind === "input" && block.inputType === "password",
		);
		if (!password || password.kind !== "input") throw new Error("no field");
		expect(() =>
			actOnRef(document, {
				ref: password.ref,
				docToken: outline.docToken,
				action: "input",
				value: "hunter2",
			}),
		).toThrow();
	});
});
