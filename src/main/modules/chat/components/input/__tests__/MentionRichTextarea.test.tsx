import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MentionRichTextarea } from "../MentionRichTextarea";

const setup = (value = "") => {
	const onChange = vi.fn();
	const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
	const { getByRole } = render(
		<form onSubmit={onSubmit}>
			<MentionRichTextarea value={value} onChange={onChange} />
		</form>,
	);
	const box = getByRole("textbox") as HTMLDivElement;
	return { box, onChange, onSubmit };
};

const placeCursor = (box: HTMLElement, start: number, end = start) => {
	const text = box.firstChild as Text;
	const range = document.createRange();
	range.setStart(text, start);
	range.setEnd(text, end);
	const sel = window.getSelection();
	sel?.removeAllRanges();
	sel?.addRange(range);
};

describe("MentionRichTextarea with an IME", () => {
	it("leaves the DOM alone while composing and commits on compositionend", () => {
		const { box, onChange } = setup();
		fireEvent.compositionStart(box);
		// The IME's in-progress text node must survive the input event.
		const composing = document.createTextNode("vie");
		box.appendChild(composing);
		fireEvent.input(box);

		expect(box.firstChild).toBe(composing);
		expect(onChange).not.toHaveBeenCalled();

		composing.textContent = "việt";
		fireEvent.compositionEnd(box);

		expect(onChange).toHaveBeenCalledWith("việt", expect.any(Number));
	});

	it("does not send when Enter confirms an IME candidate", () => {
		const { box, onSubmit } = setup("ni");
		fireEvent.compositionStart(box);
		fireEvent.keyDown(box, { key: "Enter" });
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.compositionEnd(box);
		// Safari: the confirming Enter arrives after compositionend as 229.
		fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(box, { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});
});

describe("MentionRichTextarea paste", () => {
	it("inserts plain text over the selection and keeps line breaks", () => {
		const { box, onChange } = setup("hello world");
		placeCursor(box, 6, 11);

		fireEvent.paste(box, {
			clipboardData: {
				getData: (type: string) =>
					type === "text/plain" ? "there\r\nfriend" : "<b>there</b>",
			},
		});

		expect(onChange).toHaveBeenLastCalledWith("hello there\nfriend", 18);
		expect(box.innerHTML).toBe("hello there<br>friend");
	});

	const pasteInto = (
		box: HTMLElement,
		content: { text?: string; files?: File[] },
	) =>
		fireEvent.paste(box, {
			clipboardData: {
				files: content.files ?? [],
				items: [],
				types: [],
				getData: (type: string) =>
					type === "text/plain" ? (content.text ?? "") : "",
			},
		});

	it("hands a pasted picture to the parent instead of the text", () => {
		const onChange = vi.fn();
		const onPasteFiles = vi.fn();
		const { getByRole } = render(
			<MentionRichTextarea
				value="look at"
				onChange={onChange}
				onPasteFiles={onPasteFiles}
			/>,
		);
		const box = getByRole("textbox") as HTMLDivElement;
		const shot = new File([new Uint8Array([1])], "image.png", {
			type: "image/png",
		});

		pasteInto(box, { files: [shot] });
		expect(onPasteFiles).toHaveBeenLastCalledWith([shot]);

		// An image's data URL is a picture too, not text to type.
		pasteInto(box, {
			text: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		});
		const [[image]] = onPasteFiles.mock.calls.at(-1) as [File[]];
		expect(image.type).toBe("image/png");

		expect(onChange).not.toHaveBeenCalled();
		expect(box.textContent).toBe("look at");
	});

	it("puts nothing in the field for a paste without text", () => {
		const { box, onChange } = setup("hello");
		const shot = new File([new Uint8Array([1])], "image.png", {
			type: "image/png",
		});
		const event = pasteInto(box, { files: [shot] });

		// The browser's paste is prevented: no <img> lands in the field.
		expect(event).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
		expect(box.innerHTML).toBe("hello");
	});
});
