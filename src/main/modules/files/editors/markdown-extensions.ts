/**
 * Tiptap setup for editing a markdown file in place.
 *
 * The file stays markdown on disk and the agent reads it verbatim, so the
 * editor parses and writes markdown directly with `@tiptap/markdown` instead
 * of converting through HTML (marked → HTML → turndown lost tables, task
 * lists, underline and `~~strike~~`). What the editor cannot show as rich text
 * stays editable as source: front matter, and block HTML such as `<details>`,
 * comments, `<div align>` or a prompt's `<instructions>` tags.
 */

import { type AnyExtension, type Editor, Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import Underline from "@tiptap/extension-underline";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/** A YAML front matter block at the very start of a file. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

const sourceText = (text: string) => (text ? [{ type: "text", text }] : []);

/**
 * Block HTML, kept as editable source. The schema has no node for most HTML,
 * so parsing it as rich text drops the tags and keeps only their text.
 */
const HtmlBlock = Node.create({
	name: "htmlBlock",
	group: "block",
	content: "text*",
	marks: "",
	code: true,
	defining: true,
	parseHTML: () => [
		{ tag: "pre[data-html-block]", preserveWhitespace: "full" },
	],
	renderHTML: ({ HTMLAttributes }) => [
		"pre",
		{ ...HTMLAttributes, "data-html-block": "" },
		["code", 0],
	],
	markdownTokenName: "html",
	// Inline HTML never reaches this handler; it stays with the paragraph. An
	// empty result hands a token back to the default handling.
	parseMarkdown: (token) =>
		token.block
			? {
					type: "htmlBlock",
					content: sourceText(String(token.raw ?? "").replace(/\s+$/, "")),
				}
			: [],
	renderMarkdown: (node, helpers) => helpers.renderChildren(node),
});

/** Front matter, kept as editable source at the top of the document. */
const FrontMatter = Node.create({
	name: "frontMatter",
	group: "block",
	content: "text*",
	marks: "",
	code: true,
	defining: true,
	parseHTML: () => [
		{ tag: "pre[data-front-matter]", preserveWhitespace: "full" },
	],
	renderHTML: ({ HTMLAttributes }) => [
		"pre",
		{ ...HTMLAttributes, "data-front-matter": "" },
		["code", 0],
	],
	renderMarkdown: (node, helpers) =>
		`---\n${helpers.renderChildren(node)}\n---`,
});

/**
 * Markdown has no underline. `@tiptap/markdown` writes `++text++`, which the
 * GFM preview shows literally; `<u>` renders there and parses back.
 */
const HtmlUnderline = Underline.extend({
	renderMarkdown: (node, helpers) => `<u>${helpers.renderChildren(node)}</u>`,
	markdownOptions: { htmlReopen: { open: "<u>", close: "</u>" } },
});

/** Tables render padded with blank lines, which doubles the block spacing. */
const renderTable = Table.config.renderMarkdown;
const MarkdownTable = Table.extend({
	renderMarkdown: (node, helpers, context) =>
		(renderTable?.(node, helpers, context) ?? "").replace(/^\n+|\n+$/g, ""),
});

export function createMarkdownExtensions(
	options: { placeholder?: string } = {},
): AnyExtension[] {
	return [
		StarterKit.configure({
			heading: { levels: [1, 2, 3, 4, 5, 6] },
			underline: false,
		}),
		HtmlUnderline,
		Image.configure({ inline: false, allowBase64: true }),
		MarkdownTable.configure({ resizable: false }),
		TableRow,
		TableHeader,
		TableCell,
		TaskList,
		TaskItem.configure({ nested: true }),
		HtmlBlock,
		FrontMatter,
		...(options.placeholder
			? [Placeholder.configure({ placeholder: options.placeholder })]
			: []),
		Markdown,
	];
}

/** Replace the document with `markdown`, front matter included. */
export function setMarkdownContent(editor: Editor, markdown: string): void {
	const manager = editor.markdown;
	if (!manager) throw new Error("The editor has no Markdown extension.");
	const match = FRONT_MATTER.exec(markdown);
	const body = match ? markdown.slice(match[0].length) : markdown;
	const doc = manager.parse(body);
	if (match) {
		doc.content = [
			{ type: "frontMatter", content: sourceText(match[1]) },
			...(doc.content ?? []),
		];
	}
	editor.commands.setContent(doc, { emitUpdate: false });
}

/**
 * The document as markdown, ending with a newline when `source` did: files
 * usually end with one, and keeping it saves a needless change.
 */
export function getMarkdownContent(editor: Editor, source: string): string {
	const markdown = editor.getMarkdown().replace(/\n+$/, "");
	return markdown && source.endsWith("\n") ? `${markdown}\n` : markdown;
}
