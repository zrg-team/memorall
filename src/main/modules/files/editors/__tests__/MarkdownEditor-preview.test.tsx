import type React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentFile } from "@/types/document-library";

/**
 * The preview is the whole document parsed and rendered. The viewer around it
 * redraws for the tree, the list and the index status, and the preview used
 * to be parsed again each time.
 */

const parses = vi.hoisted(() => vi.fn());
vi.mock("react-markdown", () => ({
	default: ({ children }: { children: string }) => {
		parses(children);
		return <div>{children}</div>;
	},
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFile: vi.fn() },
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/main/components/molecules/ThemeContext", () => ({
	useTheme: () => ({ actualTheme: "dark" }),
}));
vi.mock("@/main/components/atoms/MermaidRenderer", () => ({
	MermaidRenderer: () => null,
}));
vi.mock("react-syntax-highlighter", () => ({
	Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
	oneDark: {},
	oneLight: {},
}));
vi.mock("../MarkdownWysiwyg", () => ({ MarkdownWysiwyg: () => null }));

import { MarkdownEditor } from "../MarkdownEditor";

const file = {
	id: "/notes/page.md",
	name: "page.md",
	path: "/notes/page.md",
	type: "markdown",
} as unknown as DocumentFile;

describe("MarkdownEditor preview", () => {
	it("parses the document once per content, not once per redraw", () => {
		const view = render(
			<MarkdownEditor
				file={file}
				initialContent="# One"
				onSave={async () => {}}
			/>,
		);
		// A new save callback on every parent render, as the viewer passes it.
		view.rerender(
			<MarkdownEditor
				file={file}
				initialContent="# One"
				onSave={async () => {}}
			/>,
		);
		expect(parses).toHaveBeenCalledTimes(1);

		view.rerender(
			<MarkdownEditor
				file={file}
				initialContent="# Two"
				onSave={async () => {}}
			/>,
		);
		expect(parses).toHaveBeenCalledTimes(2);
		expect(parses).toHaveBeenLastCalledWith("# Two");
	});
});
