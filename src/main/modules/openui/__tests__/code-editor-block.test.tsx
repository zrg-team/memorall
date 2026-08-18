import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodeEditorBlock } from "../components/code-editor-block";
import { clearOpenUIState } from "../openui-form-state";

const formState = vi.hoisted(() => ({ values: new Map<string, unknown>() }));

// The DSL supplies form context; the component's contract with it is what these
// exercise — that a named editor reads and writes form state rather than its own.
vi.mock("@openuidev/react-lang", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		useFormName: () => "codeForm",
		useGetFieldValue: () => (form: string, name: string) =>
			formState.values.get(`${form}.${name}`),
		useSetFieldValue:
			() => (form: string, _type: string, name: string, value: unknown) =>
				formState.values.set(`${form}.${name}`, value),
		useSetDefaultValue: () => undefined,
		useIsStreaming: () => false,
	};
});

const Editor = CodeEditorBlock.component as React.FC<{
	props: {
		code: string;
		language?: string;
		filename?: string;
		height?: number;
		preview?: boolean;
		name?: string;
		label?: string;
	};
}>;

const renderEditor = (props: {
	code: string;
	language?: string;
	filename?: string;
	height?: number;
	preview?: boolean;
	name?: string;
	label?: string;
}) => {
	const view = render(<Editor props={{ language: "typescript", ...props }} />);
	return {
		...view,
		textarea: () => view.container.querySelector("textarea"),
		frame: () => view.container.querySelector("iframe"),
	};
};

describe("CodeEditorBlock", () => {
	beforeEach(() => {
		clearOpenUIState();
		formState.values.clear();
	});

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

	it("keeps edits when the message scrolls away and comes back", () => {
		// DeferredMount unmounts the whole tree once it is far off-screen. Plain
		// component state would lose whatever had been typed.
		const first = renderEditor({ code: "const a = 1;" });
		const editor = first.textarea();
		if (!editor) throw new Error("expected a textarea");
		fireEvent.change(editor, { target: { value: "const a = 99;" } });
		first.unmount();

		const second = renderEditor({ code: "const a = 1;" });
		expect(second.textarea()?.value).toBe("const a = 99;");
	});

	it("does not hand one editor's edits to a different snippet", () => {
		const first = renderEditor({ code: "aaa" });
		const editor = first.textarea();
		if (!editor) throw new Error("expected a textarea");
		fireEvent.change(editor, { target: { value: "edited" } });
		first.unmount();

		expect(renderEditor({ code: "bbb" }).textarea()?.value).toBe("bbb");
	});

	it("writes into form state when it is given a name", () => {
		const { textarea } = renderEditor({ code: "start", name: "snippet" });
		const editor = textarea();
		if (!editor) throw new Error("expected a textarea");

		fireEvent.change(editor, { target: { value: "edited by user" } });
		expect(formState.values.get("codeForm.snippet")).toBe("edited by user");
	});

	it("renders the value the form already holds, not the original source", () => {
		formState.values.set("codeForm.snippet", "from the form");
		expect(
			renderEditor({ code: "original", name: "snippet" }).textarea()?.value,
		).toBe("from the form");
	});

	it("leaves form state alone when it has no name", () => {
		const { textarea } = renderEditor({ code: "start" });
		const editor = textarea();
		if (!editor) throw new Error("expected a textarea");

		fireEvent.change(editor, { target: { value: "scratch" } });
		expect(formState.values.size).toBe(0);
	});

	it("clamps height the same way HtmlBlock does", () => {
		const { textarea } = renderEditor({ code: "x", height: 10000 });
		expect(textarea()?.style.height).toBe("900px");
	});
});
