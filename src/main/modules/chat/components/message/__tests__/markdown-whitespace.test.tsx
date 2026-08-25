import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserMessageContent } from "../UserMessageContent";

vi.mock("../MessageContentWithArtifacts", () => ({
	MessageContentWithArtifacts: ({ content }: { content: string }) => (
		<div data-testid="markdown">{content}</div>
	),
}));

const globalsCss = readFileSync(
	resolve(process.cwd(), "src/globals.css"),
	"utf8",
);

const ruleFor = (selector: string): string => {
	const start = globalsCss.indexOf(`${selector} {`);
	expect(start, `missing rule for ${selector}`).toBeGreaterThan(-1);
	return globalsCss.slice(start, globalsCss.indexOf("}", start));
};

describe("markdown whitespace ownership", () => {
	/*
	 * react-markdown puts a literal "\n" text node between every block it
	 * renders. The chat host wraps message content in `whitespace-pre-wrap` so
	 * typed text keeps its line breaks, and that inherits into the Markdown
	 * subtree, where each separator becomes a rendered blank line — a full
	 * extra line between every paragraph, heading, and bullet.
	 */
	it("resets white-space at the Markdown root so a host's pre-wrap cannot leak in", () => {
		expect(ruleFor(".markdown-body")).toMatch(/white-space:\s*normal/);
	});

	it("scopes the preserve-breaks opt-in to text boxes, never the root", () => {
		const optIn = ruleFor(
			".markdown-preserve-breaks .markdown-body p,\n.markdown-preserve-breaks .markdown-body li:not(:has(> p))",
		);

		expect(optIn).toMatch(/white-space:\s*pre-wrap/);
		// A loose list item wraps its text in <p>; the separators around that <p>
		// are the ones that must stay collapsed.
		expect(optIn).toContain("li:not(:has(> p))");
		expect(globalsCss).not.toMatch(
			/\.markdown-preserve-breaks\s+\.markdown-body\s*\{/,
		);
	});

	it("no longer patches list items individually now the root owns whitespace", () => {
		expect(
			ruleFor(".markdown-body ol > li,\n.markdown-body ul > li"),
		).not.toMatch(/white-space/);
	});
});

describe("UserMessageContent", () => {
	it("opts a typed message into preserved line breaks", () => {
		const { container } = render(
			<UserMessageContent content={"line one\nline two"} isStreaming={false} />,
		);

		expect(
			container.querySelector(
				".markdown-preserve-breaks [data-testid=markdown]",
			),
		).not.toBeNull();
	});

	it("leaves the context-carrying layout on plain Markdown whitespace", () => {
		const { container } = render(
			<UserMessageContent
				content={"hello<context>\n<text>note</text>\n</context>"}
				isStreaming={false}
			/>,
		);

		expect(container.querySelector(".markdown-preserve-breaks")).toBeNull();
	});
});
