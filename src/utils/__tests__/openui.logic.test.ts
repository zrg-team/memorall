import { describe, expect, it } from "vitest";
import {
	closeUnbalancedBrackets,
	createAppendAwareOpenUISplitter,
	splitOpenUIContent,
} from "../openui";

describe("splitOpenUIContent", () => {
	it("segments prose and OpenUI language blocks", () => {
		const segments = splitOpenUIContent(
			'Intro\nroot = CardBlock("Title", "Description", [])\nOutro',
		);

		expect(segments).toEqual([
			{ kind: "text", text: "Intro\n", start: 0, end: 6 },
			expect.objectContaining({
				kind: "openui",
				content: 'root = CardBlock("Title", "Description", [])',
				complete: true,
			}),
			expect.objectContaining({ kind: "text", text: "\nOutro" }),
		]);
	});

	it("normalizes bare CardBlock expressions into root assignments", () => {
		const segments = splitOpenUIContent('CardBlock("Title", "Desc", [])');

		expect(segments).toEqual([
			expect.objectContaining({
				kind: "openui",
				content: 'root = CardBlock("Title", "Desc", [])',
				complete: true,
			}),
		]);
	});

	it("surfaces incomplete OpenUI source for progressive streaming renders", () => {
		const incomplete = 'Before\nroot = CardBlock("Title"';

		expect(
			splitOpenUIContent(incomplete, {
				includeIncomplete: false,
			}),
		).toEqual([
			{
				kind: "text",
				text: 'Before\nroot = CardBlock("Title"',
				start: 0,
				end: incomplete.length,
			},
		]);

		expect(
			splitOpenUIContent(incomplete, {
				includeIncomplete: true,
			}),
		).toEqual([
			{ kind: "text", text: "Before\n", start: 0, end: 7 },
			{
				kind: "openui",
				content: 'root = CardBlock("Title"',
				start: 7,
				end: incomplete.length,
				complete: false,
			},
		]);
	});

	it("keeps root-first named statements in one progressively renderable program", () => {
		const content = [
			'root = CardBlock("Title", "", [section_1, section_2])',
			'section_1 = TextContent("First")',
			'section_2 = TextContent("Second")',
		].join("\n");

		expect(splitOpenUIContent(content)).toEqual([
			expect.objectContaining({
				kind: "openui",
				content,
				complete: true,
			}),
		]);
	});

	it("tracks append-only OpenUI streams and resets after a replacement edit", () => {
		const splitter = createAppendAwareOpenUISplitter();
		expect(
			splitter.split('Intro\nroot = CardBlock("T"', {
				includeIncomplete: true,
			}),
		).toEqual([
			expect.objectContaining({ kind: "text", text: "Intro\n" }),
			expect.objectContaining({ kind: "openui", complete: false }),
		]);

		expect(splitter.split('root = CardBlock("Replacement", "", [])')).toEqual([
			expect.objectContaining({
				kind: "openui",
				content: 'root = CardBlock("Replacement", "", [])',
				complete: true,
			}),
		]);
	});
});

/** Text segments that carry something, ignoring the trailing newline. */
const spilledText = (content: string): string[] =>
	splitOpenUIContent(content)
		.filter((segment) => segment.kind === "text")
		.map((segment) => (segment as { text: string }).text.trim())
		.filter(Boolean);

const renderedSource = (content: string): string =>
	splitOpenUIContent(content)
		.filter((segment) => segment.kind === "openui")
		.map((segment) => (segment as { content: string }).content)
		.join("\n");

describe("keeping a whole answer out of the reader's face", () => {
	it("finds a program that does not begin with CardBlock", () => {
		// An answer that opens with a table used to be shown as its own source,
		// because the search anchored on CardBlock alone.
		const content = [
			'section_2 = TableBlock("Deal snapshot", [ Col("Item", "left") ], [ ["Price", "9.88"] ])',
			'section_3 = TextContent("Rough economics")',
		].join("\n\n");

		expect(spilledText(content)).toEqual([]);
		expect(renderedSource(content)).toContain("TableBlock");
		expect(renderedSource(content)).toContain("TextContent");
	});

	it("does not mistake prose for a program", () => {
		const content =
			"The deal (as listed) costs 9.88 ty. Ask the agent (twice).";
		expect(spilledText(content)).toEqual([content]);
	});

	it("keeps later sections when one statement loses a bracket", () => {
		// Exactly what a model produced: TableBlock never closed, so every
		// section after it reached the reader as source.
		const content = [
			'root = CardBlock("Reading this listing", "sub", [ TextContent("body") ])',
			'section_2 = TableBlock("Deal snapshot", [ Col("Item", "left") ], [ ["Price", "9.88"]',
			'section_3 = TextContent("Rough economics")',
			'section_4 = AlertBlock("Main risk", "body", "default")',
		].join("\n\n");

		expect(spilledText(content)).toEqual([]);
		const source = renderedSource(content);
		for (const name of [
			"CardBlock",
			"TableBlock",
			"TextContent",
			"AlertBlock",
		]) {
			expect(source).toContain(name);
		}
	});

	it("carries the rest of a real answer's components through", () => {
		const content = [
			'root = CardBlock("Title", "sub", [ TextContent("body") ])',
			'section_5 = CollapsibleBlock("5 actions", [ TextContent("1. Compare", "sm") ])',
			'section_6 = FollowUpBlock([ FollowUpItem("Assess this", "prompt") ])',
		].join("\n\n");

		expect(spilledText(content)).toEqual([]);
		const source = renderedSource(content);
		expect(source).toContain("CollapsibleBlock");
		expect(source).toContain("FollowUpBlock");
		expect(source).toContain("FollowUpItem");
	});
});

describe("closeUnbalancedBrackets", () => {
	it("leaves well-formed source alone", () => {
		const source = 'CardBlock("a", [ TextContent("b") ])';
		expect(closeUnbalancedBrackets(source)).toBe(source);
	});

	it("closes what a statement left open, innermost first", () => {
		expect(closeUnbalancedBrackets('TableBlock("a", [ ["b"]')).toBe(
			'TableBlock("a", [ ["b"]])',
		);
	});

	it("ignores brackets inside strings", () => {
		const source = 'TextContent("a (b) [c]")';
		expect(closeUnbalancedBrackets(source)).toBe(source);
	});

	it("closes an unterminated string before its brackets", () => {
		expect(closeUnbalancedBrackets('TextContent("half')).toBe(
			'TextContent("half")',
		);
	});
});
