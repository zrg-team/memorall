import { describe, expect, it } from "vitest";
import {
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

		expect(
			splitter.split('root = CardBlock("Replacement", "", [])'),
		).toEqual([
			expect.objectContaining({
				kind: "openui",
				content: 'root = CardBlock("Replacement", "", [])',
				complete: true,
			}),
		]);
	});
});
