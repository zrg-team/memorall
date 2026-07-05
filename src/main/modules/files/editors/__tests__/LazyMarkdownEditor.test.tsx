import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentFile } from "@/types/document-library";

// Mock the heavy editor so the lazy loader resolves to a lightweight stand-in
// (the real editor pulls in TipTap/marked/turndown and must not load in tests).
vi.mock("../MarkdownEditor", () => ({
	MarkdownEditor: ({ initialContent }: { initialContent: string }) => (
		<div data-testid="markdown-editor">md:{initialContent}</div>
	),
}));

import { LazyMarkdownEditor } from "../LazyMarkdownEditor";

describe("LazyMarkdownEditor", () => {
	it("lazily loads and renders the markdown editor behind Suspense", async () => {
		render(
			<LazyMarkdownEditor
				file={{ name: "note.md" } as unknown as DocumentFile}
				initialContent="hello"
				onSave={async () => {}}
			/>,
		);

		expect(await screen.findByTestId("markdown-editor")).toHaveTextContent(
			"md:hello",
		);
	});
});
