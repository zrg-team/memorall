import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentFile } from "@/types/document-library";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tiptap/starter-kit", () => {
	const stub: { configure: () => unknown } = { configure: () => stub };
	return { default: stub };
});
vi.mock("@tiptap/extension-image", () => {
	const stub: { configure: () => unknown } = { configure: () => stub };
	return { default: stub };
});
vi.mock("@tiptap/extension-table", () => {
	const stub: { configure: () => unknown } = { configure: () => stub };
	return { Table: stub };
});
vi.mock("@tiptap/extension-table-row", () => ({ TableRow: {} }));
vi.mock("@tiptap/extension-table-header", () => ({ TableHeader: {} }));
vi.mock("@tiptap/extension-table-cell", () => ({ TableCell: {} }));
vi.mock("@tiptap/extension-placeholder", () => {
	const stub: { configure: () => unknown } = { configure: () => stub };
	return { default: stub };
});

/**
 * Stands in for a TipTap editor that has already been torn down: `destroy()`
 * nulls the command manager, so reading `commands` throws exactly as the real
 * one does. Tiptap can hand this instance back to a render that happens between
 * an unmount and the delayed teardown.
 */
vi.mock("@tiptap/react", () => {
	const editor = {
		isDestroyed: true,
		get commands(): never {
			throw new TypeError(
				"Cannot read properties of null (reading 'commands')",
			);
		},
		getHTML: () => "",
		getText: () => "",
		getAttributes: () => ({}),
		isActive: () => false,
		storage: {},
		destroy: vi.fn(),
	};
	return {
		useEditor: () => editor,
		EditorContent: () => <div data-testid="editor-content" />,
	};
});

import { MarkdownWysiwyg } from "../MarkdownWysiwyg";

const file = {
	id: "/notes/page.md",
	name: "page.md",
	path: "/notes/page.md",
	type: "markdown",
} as unknown as DocumentFile;

describe("MarkdownWysiwyg", () => {
	it("does not run commands on a destroyed editor instance", () => {
		expect(() =>
			render(
				<MarkdownWysiwyg
					file={file}
					initialContent="# Kingdom"
					onSave={async () => {}}
					onRequestPreview={() => {}}
				/>,
			),
		).not.toThrow();

		expect(screen.getByTestId("editor-content")).toBeInTheDocument();
	});
});
