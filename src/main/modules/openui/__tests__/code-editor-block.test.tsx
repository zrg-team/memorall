import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeEditorBlock } from "../components/code-editor-block";

const Editor = CodeEditorBlock.component as React.FC<{
	props: {
		code: string;
		language?: string;
		filename?: string;
		height?: number;
		preview?: boolean;
	};
}>;

const renderEditor = (props: {
	code: string;
	language?: string;
	filename?: string;
	height?: number;
	preview?: boolean;
}) => {
	const view = render(<Editor props={{ language: "typescript", ...props }} />);
	return {
		...view,
		textarea: () => view.container.querySelector("textarea"),
		frame: () => view.container.querySelector("iframe"),
	};
};

describe("CodeEditorBlock", () => {
	it("lets the user change the code", () => {
		const { textarea } = renderEditor({ code: "const a = 1;" });
		const editor = textarea();
		if (!editor) throw new Error("expected a textarea");

		fireEvent.change(editor, { target: { value: "const a = 2;" } });
		expect(editor.value).toBe("const a = 2;");
	});

	it("marks itself dirty and restores the original on reset", () => {
		const { textarea } = renderEditor({ code: "original", filename: "a.ts" });
		const editor = textarea();
		if (!editor) throw new Error("expected a textarea");

		expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();

		fireEvent.change(editor, { target: { value: "edited" } });
		const reset = screen.getByRole("button", { name: /reset/i });
		expect(reset).not.toBeDisabled();

		fireEvent.click(reset);
		expect(editor.value).toBe("original");
	});

	it("inserts an indent for Tab instead of leaving the editor", () => {
		const { textarea } = renderEditor({ code: "ab" });
		const editor = textarea();
		if (!editor) throw new Error("expected a textarea");

		editor.setSelectionRange(1, 1);
		fireEvent.keyDown(editor, { key: "Tab" });
		expect(editor.value).toBe("a  b");
	});

	it("offers preview for html without being asked", () => {
		renderEditor({ code: "<p>hi</p>", language: "html" });
		expect(
			screen.getByRole("button", { name: /preview/i }),
		).toBeInTheDocument();
	});

	it("does not offer preview for a language it cannot run", () => {
		renderEditor({ code: "print(1)", language: "python" });
		expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
	});

	it("previews what the user typed, not what arrived, under the shared sandbox", () => {
		const { textarea, frame } = renderEditor({
			code: "<p>before</p>",
			language: "html",
		});
		const editor = textarea();
		if (!editor) throw new Error("expected a textarea");

		fireEvent.change(editor, { target: { value: "<p>after</p>" } });
		fireEvent.click(screen.getByRole("button", { name: /preview/i }));

		const preview = frame();
		expect(preview?.getAttribute("srcdoc")).toBe("<p>after</p>");
		// Same posture as HtmlBlock: scripts run, the host page stays unreachable.
		expect(preview?.getAttribute("sandbox")).toBe("allow-scripts");
	});

	it("can be forced to preview a non-html language, and back to code", () => {
		const { frame, textarea } = renderEditor({
			code: "<svg/>",
			language: "xml",
			preview: true,
		});
		fireEvent.click(screen.getByRole("button", { name: /preview/i }));
		expect(frame()).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /code/i }));
		expect(textarea()).not.toBeNull();
	});

	it("clamps height the same way HtmlBlock does", () => {
		const { textarea } = renderEditor({ code: "x", height: 10000 });
		expect(textarea()?.style.height).toBe("900px");
	});
});
