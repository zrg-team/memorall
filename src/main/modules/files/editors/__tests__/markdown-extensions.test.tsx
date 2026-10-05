import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMarkdownExtensions,
	getMarkdownContent,
	setMarkdownContent,
} from "../markdown-extensions";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

const roundTrip = (markdown: string): string => {
	const editor = new Editor({ extensions: createMarkdownExtensions() });
	editors.push(editor);
	setMarkdownContent(editor, markdown);
	return getMarkdownContent(editor, markdown);
};

describe("markdown editor round trip", () => {
	it("keeps GFM tables as tables", () => {
		const out = roundTrip(
			"> quote\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n",
		);
		expect(out).toMatch(
			/^> quote\n\n\| A +\| B +\|\n\| -+ \| -+ \|\n\| 1 +\| 2 +\|\n\nafter\n$/,
		);
		expect(out).not.toContain("<table");
	});

	it("keeps strikethrough, underline and task lists", () => {
		const out = roundTrip(
			"Some ~~gone~~ and <u>under</u> text.\n\n- [ ] todo\n- [x] done\n",
		);
		expect(out).toContain("~~gone~~");
		expect(out).toContain("<u>under</u>");
		expect(out).toContain("- [ ] todo\n- [x] done");
	});

	it("leaves code untouched", () => {
		const source = '```ts\nconst a = "$&" + snake_case * 2;\n```\n';
		expect(roundTrip(source)).toBe(source);
	});

	it("keeps block HTML and front matter as source", () => {
		const source = [
			"---",
			"title: Notes",
			"tags: [a, b]",
			"---",
			"",
			"# Notes",
			"",
			"<details><summary>More</summary>hidden</details>",
			"",
			"<!-- keep me -->",
			"",
			'<div align="center">',
			'<img src="logo.png" width="80">',
			"</div>",
			"",
		].join("\n");
		expect(roundTrip(source)).toBe(source);
	});

	it("is stable once normalized", () => {
		const source = [
			"# Title",
			"",
			"Some **bold**, *italic*, `code` and [link](https://x.y).",
			"Second line of the paragraph.",
			"",
			"- item 1",
			"  - nested",
			"- item 2",
			"",
			"1. one",
			"2. two",
			"",
			"> quote",
			"",
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"",
			"![alt](./img.png)",
			"",
			"---",
			"",
		].join("\n");
		const once = roundTrip(source);
		expect(roundTrip(once)).toBe(once);
	});
});
