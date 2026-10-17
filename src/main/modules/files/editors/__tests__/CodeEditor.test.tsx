import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentFile } from "@/types/document-library";

const highlights = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-syntax-highlighter", () => ({
	Prism: ({ children }: { children: string }) => {
		highlights(children.length);
		return <pre>{children}</pre>;
	},
}));
vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
	oneDark: {},
	oneLight: {},
}));

import { CodeEditor, MAX_HIGHLIGHTED_CHARS } from "../CodeEditor";

const file: DocumentFile = {
	id: "/data.json",
	name: "data.json",
	path: "/data.json",
	type: "text",
	mimeType: "application/json",
	size: 0,
	createdAt: new Date(0),
	modifiedAt: new Date(0),
};

describe("CodeEditor", () => {
	it("highlights a file of ordinary size", () => {
		highlights.mockClear();
		render(
			<CodeEditor file={file} initialContent={'{ "a": 1 }'} onSave={vi.fn()} />,
		);
		expect(highlights).toHaveBeenCalled();
	});

	it("shows a big file as plain text, which the highlighter overflowed on", () => {
		highlights.mockClear();
		const big = "x".repeat(MAX_HIGHLIGHTED_CHARS + 1);
		render(<CodeEditor file={file} initialContent={big} onSave={vi.fn()} />);
		expect(highlights).not.toHaveBeenCalled();
		const text = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(text.value).toHaveLength(big.length);
		expect(text.style.color).not.toBe("transparent");
	});
});
