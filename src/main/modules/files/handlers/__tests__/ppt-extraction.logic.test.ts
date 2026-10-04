import { CFB } from "xlsx";
import { describe, expect, it } from "vitest";
import type { SlideElement } from "../pptx-extraction";
import { presentationToMarkdown, readPresentation } from "../pptx-extraction";

const concat = (parts: Uint8Array[]): Uint8Array => {
	const bytes = new Uint8Array(
		parts.reduce((sum, part) => sum + part.length, 0),
	);
	let at = 0;
	for (const part of parts) {
		bytes.set(part, at);
		at += part.length;
	}
	return bytes;
};

const numbers = (size: 2 | 4, ...values: number[]): Uint8Array => {
	const bytes = new Uint8Array(values.length * size);
	const view = new DataView(bytes.buffer);
	values.forEach((value, index) => {
		if (size === 2) view.setInt16(index * 2, value, true);
		else view.setUint32(index * 4, value >>> 0, true);
	});
	return bytes;
};

/** A PowerPoint binary record: header, then data or child records. */
const record = (
	type: number,
	children: Uint8Array[],
	{ instance = 0, container = false } = {},
): Uint8Array => {
	const data = concat(children);
	const header = new Uint8Array(8);
	const view = new DataView(header.buffer);
	view.setUint16(0, (instance << 4) | (container ? 0xf : 0), true);
	view.setUint16(2, type, true);
	view.setUint32(4, data.length, true);
	return concat([header, data]);
};
const container = (type: number, children: Uint8Array[], instance = 0) =>
	record(type, children, { container: true, instance });

const utf16 = (text: string) =>
	new Uint8Array(
		new Uint16Array([...text].map((char) => char.charCodeAt(0))).buffer,
	);
const latin1 = (text: string) =>
	Uint8Array.from([...text].map((char) => char.charCodeAt(0)));

/** A one-slide .ppt; `drawn` puts the slide's text in its drawing. */
const ppt = (drawn: boolean): Uint8Array => {
	const documentContainer = container(0x03e8, [
		record(0x03e9, [numbers(4, 5760, 4320), new Uint8Array(32)]),
		container(
			0x0ff0,
			[
				record(0x03f3, [numbers(4, 2, 0, 2, 256, 0)]),
				record(0x0f9f, [numbers(4, 0)]),
				record(0x0fa0, [utf16("Legacy title")]),
				record(0x0f9f, [numbers(4, 1)]),
				record(0x0fa8, [latin1("First\rSecond\vline")]),
			],
			0,
		),
	]);
	const shapes = drawn
		? [
				container(0xf004, [
					record(0xf010, [numbers(2, 100, 200, 1000, 400)]),
					container(0xf00d, [record(0x0f9e, [numbers(4, 0)])]),
				]),
				container(0xf004, [
					container(0xf00d, [
						record(0x0f9f, [numbers(4, 4)]),
						record(0x0fa0, [utf16("Free text box")]),
					]),
				]),
			]
		: [];
	const slide = container(0x03ee, [
		record(0x03ef, [new Uint8Array(24)]),
		container(0x040c, [container(0xf002, [container(0xf003, shapes)])]),
	]);
	const slideOffset = documentContainer.length;
	const directoryOffset = slideOffset + slide.length;
	const directory = record(0x1772, [numbers(4, (2 << 20) | 1, 0, slideOffset)]);
	const editOffset = directoryOffset + directory.length;
	const edit = record(0x0ff5, [
		numbers(4, 256),
		new Uint8Array([0, 0, 0, 3]),
		numbers(4, 0, directoryOffset, 1, 3),
		new Uint8Array(4),
	]);
	const stream = concat([documentContainer, slide, directory, edit]);
	const currentUser = record(0x0ff6, [
		numbers(4, 0x14, 0xe391c05f, editOffset),
		new Uint8Array(12),
	]);

	const file = CFB.utils.cfb_new();
	CFB.utils.cfb_add(file, "PowerPoint Document", stream);
	CFB.utils.cfb_add(file, "Current User", currentUser);
	return new Uint8Array(CFB.write(file, { type: "buffer" }));
};

const texts = (elements: SlideElement[]) =>
	elements.map((element) =>
		element.kind === "shape"
			? element.text?.paragraphs.map((paragraph) =>
					paragraph.runs.map((run) => run.text).join(""),
				)
			: null,
	);

describe("legacy .ppt slides", () => {
	it("places the drawing's text boxes where the slide anchors them", async () => {
		const deck = await readPresentation(ppt(true));
		expect(deck).toMatchObject({
			width: 9144000,
			height: 6858000,
			textOnly: true,
		});
		expect(deck.slides).toHaveLength(1);
		const [title, free] = deck.slides[0].elements;
		// Anchors are in master units, 576 per inch.
		expect(title.box).toMatchObject({
			x: 200 * 1587.5,
			y: 100 * 1587.5,
			width: 800 * 1587.5,
			height: 300 * 1587.5,
		});
		expect(title.kind === "shape" && title.placeholder).toBe("title");
		expect(texts(deck.slides[0].elements)).toEqual([
			["Legacy title"],
			["Free text box"],
		]);
		expect(free.box.y).toBeGreaterThan(title.box.y);
	});

	it("falls back to the slide list's text when the drawing has none", async () => {
		const deck = await readPresentation(ppt(false));
		expect(texts(deck.slides[0].elements)).toEqual([
			["Legacy title"],
			["First", "Second\nline"],
		]);
		expect(presentationToMarkdown(deck)).toBe(
			"## Slide 1: Legacy title\n\n- First\n- Second\nline",
		);
	});
});
