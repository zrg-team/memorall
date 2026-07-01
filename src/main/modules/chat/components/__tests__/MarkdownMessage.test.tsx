import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage, hasMath } from "../MarkdownMessage";

const markdownBodyRenderSpy = vi.hoisted(() => vi.fn());

vi.mock("../message/MarkdownMessageBody", () => ({
	MarkdownMessageBody: ({ children }: { children?: React.ReactNode }) => {
		markdownBodyRenderSpy(children);
		return <div data-testid="markdown">{children}</div>;
	},
}));

describe("MarkdownMessage", () => {
	beforeEach(() => {
		markdownBodyRenderSpy.mockClear();
	});

	it("detects math so KaTeX stays off the non-math path", () => {
		expect(hasMath("plain text")).toBe(false);
		expect(hasMath("inline $x + y$ math")).toBe(true);
		expect(hasMath("block $$\nx + y\n$$ math")).toBe(true);
		expect(hasMath("escaped \\$not math$")).toBe(false);
	});

	it("does not re-render identical streaming content but rerenders when streaming flips", () => {
		const { rerender } = render(
			<MarkdownMessage isStreaming={true}>same</MarkdownMessage>,
		);

		expect(markdownBodyRenderSpy).toHaveBeenCalledTimes(1);

		rerender(<MarkdownMessage isStreaming={true}>same</MarkdownMessage>);

		expect(markdownBodyRenderSpy).toHaveBeenCalledTimes(1);

		rerender(<MarkdownMessage isStreaming={false}>same</MarkdownMessage>);

		expect(markdownBodyRenderSpy).toHaveBeenCalledTimes(2);
	});
});
