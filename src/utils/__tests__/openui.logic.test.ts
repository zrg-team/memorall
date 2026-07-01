import { describe, expect, it } from "vitest";
import { splitOpenUIContent } from "../openui";

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

	it("can surface incomplete streaming OpenUI blocks without raw content", () => {
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
				content: "",
				start: 7,
				end: incomplete.length,
				complete: false,
			},
		]);
	});
});
