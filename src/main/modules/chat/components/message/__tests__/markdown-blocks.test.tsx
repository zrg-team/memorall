import type React from "react";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	MarkdownBlocks,
	remarkPlugins,
	splitMarkdownBlocks,
} from "../markdownComponents";
import { MarkdownMessageBody } from "../MarkdownMessageBody";
import { ThinkingSections } from "../ThinkingSections";

const codeBlocks = vi.hoisted(() => ({ mounts: 0, renders: 0 }));

vi.mock("../CodeBlockWithSave", async () => {
	const ReactModule = await import("react");
	return {
		CodeBlockWithSave: ({ code }: { code: string }) => {
			codeBlocks.renders += 1;
			ReactModule.useEffect(() => {
				codeBlocks.mounts += 1;
			}, []);
			return ReactModule.createElement(
				"pre",
				{ "data-testid": "highlighted-code" },
				code,
			);
		},
	};
});

vi.mock("../../DocumentSaveFolderDialog", () => ({
	DocumentSaveFolderDialog: () => null,
}));

vi.mock("../Citation", () => ({ Citation: () => null }));

vi.mock("@/main/components/atoms/MermaidRenderer", () => ({
	MermaidRenderer: ({ chart }: { chart: string }) => (
		<div data-testid="mermaid">{chart}</div>
	),
}));

/**
 * Text from the kinds of reply the chat shows, including the places where a
 * block's meaning depends on what is around it.
 */
const CORPUS = [
	"Plain paragraph.\n\nAnother one, with *emphasis\nacross lines* and `code`.",
	"# Title\nText right under it.\n\nSetext title\n============\n\nAnd text.",
	"Paragraph\n---\n\nThen a rule:\n\n---\n\n***\n\nEnd.",
	"- tight\n- list\n\n1. ordered\n2. list\n\n\n3. after two blank lines",
	"- loose item\n\n- another\n\n  with a second paragraph\n\n  ```js\n  const inList = 1;\n  ```\n\nAfter the list.",
	"- nested\n  - deeper\n    - deepest\n- back\nlazy continuation\n\n5. starts at five\n6. six",
	"> quoted\nlazy line\n\n> second quote\n>\n> > nested\n\nOutside.",
	"Here is code:\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\nRight after it.",
	"~~~\ntilde fence\n~~~\n\n    indented code\n\n    more indented\n\nText.",
	"foo\n| a | b |\n| - | - |\n| 1 | 2 |\n\n| x | y |\n|---|:-:|\n| 3 | 4 |\nafter table",
	"- [ ] todo\n- [x] done\n\nwww.example.com and https://example.com/path?q=1",
	"Hard  \nbreak and backslash\\\nbreak.\n\n<div>\n\n*inside html*\n\n</div>\n\n<!--\n\ncomment\n\n-->\n\nDone.",
	"<pre>\nline\n\nstill pre\n</pre>\n\nafter",
	"\n\nLeading blank lines.\n\n\n\nMany blank lines.   \n",
	"Emoji 🎉 and ünïcödé — and a [link](https://example.com).\n\n## Heading ##\n\n| only header |\n| --- |",
	"Text\n```\nunclosed fence that runs\n\nto the end",
];

const renderWhole = (markdown: string) =>
	renderToStaticMarkup(
		<ReactMarkdown remarkPlugins={remarkPlugins}>{markdown}</ReactMarkdown>,
	);

const renderBlocks = (blocks: string[]) =>
	renderToStaticMarkup(
		blocks.map((block, index) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
			<ReactMarkdown key={index} remarkPlugins={remarkPlugins}>
				{block}
			</ReactMarkdown>
		)),
	);

// react-markdown separates the blocks it renders with a "\n" text node, which
// `.markdown-body` collapses; rendered apart, the blocks have none. (Raw HTML
// is shown as text, so the separator can follow text as well as a tag.)
const normalize = (html: string) => html.replace(/\n(?=<|&lt;)/g, "");

describe("splitMarkdownBlocks", () => {
	it.each(CORPUS)("renders the same cut into blocks: %j", (markdown) => {
		const { blocks } = splitMarkdownBlocks(markdown);

		expect(blocks.join("")).toBe(markdown);
		expect(normalize(renderBlocks(blocks))).toBe(
			normalize(renderWhole(markdown)),
		);
	});

	it.each(CORPUS)(
		"renders the same at every point while streaming: %j",
		(markdown) => {
			for (let end = 1; end <= markdown.length; end += 3) {
				const prefix = markdown.slice(0, end);
				const { blocks } = splitMarkdownBlocks(prefix);
				expect(normalize(renderBlocks(blocks)), prefix).toBe(
					normalize(renderWhole(prefix)),
				);
			}
		},
	);

	it("cuts only at blank lines between top-level blocks", () => {
		expect(
			splitMarkdownBlocks("One\n\nTwo\nstill two\n\n- a\n\n- b\n\nThree")
				.blocks,
		).toEqual(["One\n\n", "Two\nstill two\n\n", "- a\n\n- b\n\n", "Three"]);
	});

	it("keeps text read across blocks whole", () => {
		for (const markdown of [
			"See [the docs][docs].\n\n[docs]: https://example.com",
			"A claim.[^1]\n\nMore.\n\n[^1]: The source.",
			"Math:\n\n$$\na\n\nb\n$$\n\nAfter.",
		]) {
			expect(splitMarkdownBlocks(markdown).blocks).toEqual([markdown]);
		}
	});

	it("says where a code fence opens that is not closed yet", () => {
		expect(splitMarkdownBlocks("Intro\n```js\nconst a").openFenceAt).toBe(6);
		expect(splitMarkdownBlocks("```mermaid\ngraph TD").openFenceAt).toBe(0);
		expect(splitMarkdownBlocks("````\n```\nstill open").openFenceAt).toBe(0);
		expect(splitMarkdownBlocks("```js\nconst a = 1;\n```").openFenceAt).toBe(
			-1,
		);
		// A tool call card renders its own unfinished state.
		expect(
			splitMarkdownBlocks('```memorall_tool_call\n{"name":').openFenceAt,
		).toBe(-1);
	});
});

describe("MarkdownBlocks", () => {
	const paragraphRenders: string[] = [];
	const components = {
		p: ({ children }: { children?: React.ReactNode }) => {
			paragraphRenders.push(String(children));
			return <p>{children}</p>;
		},
	};

	beforeEach(() => {
		paragraphRenders.length = 0;
	});

	it("parses only the block being written as the text grows", () => {
		const { rerender } = render(
			<MarkdownBlocks isStreaming components={components}>
				{"First paragraph.\n\nSecond"}
			</MarkdownBlocks>,
		);
		rerender(
			<MarkdownBlocks isStreaming components={components}>
				{"First paragraph.\n\nSecond grows"}
			</MarkdownBlocks>,
		);
		rerender(
			<MarkdownBlocks isStreaming={false} components={components}>
				{"First paragraph.\n\nSecond grows."}
			</MarkdownBlocks>,
		);

		expect(
			paragraphRenders.filter((text) => text === "First paragraph."),
		).toHaveLength(1);
		expect(paragraphRenders.at(-1)).toBe("Second grows.");
	});

	it("renders text that never streamed in one piece", () => {
		render(
			<MarkdownBlocks isStreaming={false} components={components}>
				{"One.\n\nTwo."}
			</MarkdownBlocks>,
		);

		expect(screen.getByText("One.")).toBeInTheDocument();
		expect(screen.getByText("Two.")).toBeInTheDocument();
	});
});

describe("MarkdownMessageBody while streaming", () => {
	beforeEach(() => {
		codeBlocks.mounts = 0;
		codeBlocks.renders = 0;
	});

	it("shows an unfinished code block as plain text until its fence closes", () => {
		const { container, rerender } = render(
			<MarkdownMessageBody isStreaming>
				{"Here:\n```mermaid\ngraph TD\n  A-->"}
			</MarkdownMessageBody>,
		);

		expect(container.querySelector("[data-open-code-fence]")).toHaveTextContent(
			"graph TD A-->",
		);
		expect(screen.queryByTestId("mermaid")).toBeNull();
		expect(screen.getByText("Here:")).toBeInTheDocument();

		rerender(
			<MarkdownMessageBody isStreaming>
				{"Here:\n```mermaid\ngraph TD\n  A-->B\n```"}
			</MarkdownMessageBody>,
		);

		expect(container.querySelector("[data-open-code-fence]")).toBeNull();
		expect(screen.getByTestId("mermaid")).toHaveTextContent("graph TD A-->B");
	});

	it("keeps a finished code block mounted while the text after it streams and when it ends", () => {
		const code = "```js\nconst a = 1;\n```";
		const { rerender } = render(
			<MarkdownMessageBody
				isStreaming
			>{`${code}\n\nAfter`}</MarkdownMessageBody>,
		);
		rerender(
			<MarkdownMessageBody isStreaming>
				{`${code}\n\nAfter the code`}
			</MarkdownMessageBody>,
		);
		rerender(
			<MarkdownMessageBody isStreaming={false}>
				{`${code}\n\nAfter the code.`}
			</MarkdownMessageBody>,
		);

		expect(codeBlocks.mounts).toBe(1);
		expect(codeBlocks.renders).toBe(1);
		expect(screen.getByText("After the code.")).toBeInTheDocument();
	});
});

describe("MarkdownMessageBody when the reply finishes", () => {
	it("folds the model's thinking, as a freshly drawn message does", () => {
		const { rerender } = render(
			<MarkdownMessageBody isStreaming>
				{"<think>weighing options"}
			</MarkdownMessageBody>,
		);
		expect(screen.queryByText("weighing options")).not.toBeNull();

		rerender(
			<MarkdownMessageBody isStreaming={false}>
				{"<think>weighing options</think>The answer"}
			</MarkdownMessageBody>,
		);

		expect(screen.queryByText("weighing options")).toBeNull();
		expect(screen.getByText("The answer")).toBeInTheDocument();
	});
});

describe("ThinkingSections", () => {
	beforeEach(() => {
		codeBlocks.renders = 0;
	});

	it("does not render a section again when it is parsed out unchanged", () => {
		const props = {
			// The section being written is the open one.
			hasIncompleteThinking: true,
			isStreaming: true,
			components: {
				code: () => {
					codeBlocks.renders += 1;
					return <code />;
				},
			},
		};
		const { rerender } = render(
			<ThinkingSections {...props} thinking={["`a thought`"]} />,
		);
		// The body changed and the sections were parsed out again: same text.
		rerender(<ThinkingSections {...props} thinking={["`a thought`"]} />);

		expect(codeBlocks.renders).toBe(1);
	});
});
