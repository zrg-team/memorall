import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessageContent } from "@/embedded/components/messages/AssistantMessageContent";

// The dock bubble used to render raw EmbeddedMarkdown, so artifact and OpenUI
// markup arrived as literal text. It now shares the panel's renderer; these
// assert that sharing, which no browser check covers.
vi.mock("@/embedded/components/messages/EmbeddedArtifact", () => ({
	EmbeddedArtifact: () => <div data-testid="artifact" />,
}));

vi.mock("@/main/modules/openui/OpenUIRenderer", () => ({
	OpenUIRenderer: () => <div data-testid="openui" />,
}));

vi.mock("@/embedded/components/EmbeddedMarkdown", () => ({
	EmbeddedMarkdown: ({ content }: { content: string }) => (
		<div data-testid="markdown">{content}</div>
	),
}));

describe("dock bubble assistant content", () => {
	it("renders an artifact block instead of dumping its markup as text", () => {
		render(
			<AssistantMessageContent
				content={
					'Here you go.\n<artifact identifier="demo" type="text/html" title="Demo"><!doctype html><h1>Hi</h1></artifact>'
				}
				isStreaming={false}
			/>,
		);

		expect(screen.getByTestId("artifact")).toBeTruthy();
		expect(screen.queryByText(/<artifact/)).toBeNull();
	});

	it("renders OpenUI blocks through the OpenUI renderer", () => {
		render(
			<AssistantMessageContent
				content={'intro\nroot = CardBlock("Status", "Live", [])'}
				isStreaming={false}
			/>,
		);

		expect(screen.getByTestId("openui")).toBeTruthy();
	});

	it("still renders plain prose as markdown", () => {
		render(
			<AssistantMessageContent content="just words" isStreaming={false} />,
		);

		expect(screen.getByTestId("markdown").textContent).toContain("just words");
	});
});
