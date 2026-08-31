import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentFile } from "@/types/document-library";

const readFile = vi.fn();

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFile: (path: string) => readFile(path),
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/main/components/molecules/ThemeContext", () => ({
	useTheme: () => ({ actualTheme: "dark" }),
}));

vi.mock("@/main/components/atoms/MermaidRenderer", () => ({
	MermaidRenderer: () => <div data-testid="mermaid" />,
}));

vi.mock("react-syntax-highlighter", () => ({
	Prism: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
	oneDark: {},
	oneLight: {},
}));

// The WYSIWYG half drags in TipTap; here it only needs to report whether it was
// mounted, because building it for a document nobody is editing is the bug.
vi.mock("../MarkdownWysiwyg", () => ({
	MarkdownWysiwyg: () => <div data-testid="wysiwyg" />,
}));

import { MarkdownEditor } from "../MarkdownEditor";

const file = {
	id: "/notes/game/page.md",
	name: "page.md",
	path: "/notes/game/page.md",
	type: "markdown",
} as unknown as DocumentFile;

const renderEditor = (initialContent: string) =>
	render(
		<MarkdownEditor
			file={file}
			initialContent={initialContent}
			onSave={async () => {}}
		/>,
	);

describe("MarkdownEditor preview", () => {
	beforeEach(() => {
		readFile.mockReset();
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-image");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the document without building the WYSIWYG editor", () => {
		readFile.mockRejectedValue(new Error("ENOENT"));

		renderEditor("# Kingdom\n\nSome text.");

		expect(screen.getByText("Kingdom")).toBeInTheDocument();
		expect(screen.queryByTestId("wysiwyg")).not.toBeInTheDocument();
	});

	it("builds the WYSIWYG editor once the user switches to edit mode", async () => {
		readFile.mockRejectedValue(new Error("ENOENT"));

		renderEditor("# Kingdom");
		fireEvent.click(screen.getByText("editor.editMode"));

		expect(await screen.findByTestId("wysiwyg")).toBeInTheDocument();
	});

	it("loads a relative image out of the document filesystem", async () => {
		readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

		renderEditor("![Banner](banner.png)");

		await waitFor(() =>
			expect(screen.getByAltText("Banner")).toHaveAttribute(
				"src",
				"blob:preview-image",
			),
		);
		expect(readFile).toHaveBeenCalledWith("/notes/game/banner.png");
	});

	it("shows a placeholder instead of a broken image when the file is missing", async () => {
		readFile.mockRejectedValue(new Error("ENOENT"));

		const { container } = renderEditor("![Missing map](ascent-map.webp)");

		await waitFor(() => expect(screen.getByText("Missing map")).toBeVisible());
		expect(container.querySelector("img")).toBeNull();
	});

	it("leaves remote images to the browser", async () => {
		renderEditor("![Remote](https://example.com/a.png)");

		expect(await screen.findByAltText("Remote")).toHaveAttribute(
			"src",
			"https://example.com/a.png",
		);
		expect(readFile).not.toHaveBeenCalled();
	});
});
