import type {
	PresentationDeck,
	PresentationSlide,
	SlideBox,
	SlideElement,
	SlideParagraph,
} from "./pptx-extraction";

/**
 * Legacy PowerPoint (.ppt, 97–2003) slides as text: each slide's text boxes
 * where the slide places them, without fonts, pictures or drawings. Follows
 * the persist directory of the newest save to each slide, as PowerPoint does.
 */

const NOT_A_PRESENTATION = "This is not a PowerPoint presentation.";
const PASSWORD_PROTECTED = "This presentation is password-protected.";
/** Master units are 576 per inch; EMU are 914400 per inch. */
const EMU_PER_MASTER_UNIT = 914400 / 576;

const RECORD = {
	document: 0x03e8,
	documentAtom: 0x03e9,
	slide: 0x03ee,
	slidePersistAtom: 0x03f3,
	slideListWithText: 0x0ff0,
	userEditAtom: 0x0ff5,
	persistDirectoryAtom: 0x1772,
	outlineTextRefAtom: 0x0f9e,
	textHeaderAtom: 0x0f9f,
	textCharsAtom: 0x0fa0,
	textBytesAtom: 0x0fa8,
	shapeContainer: 0xf004,
	clientAnchor: 0xf010,
	clientTextbox: 0xf00d,
} as const;

/** TextHeaderAtom text types. */
const TITLE_TYPES = new Set([0, 6]);
const BULLET_TYPES = new Set([1, 7, 8]);
const CENTERED_TYPES = new Set([5, 6]);

interface RecordHeader {
	type: number;
	instance: number;
	container: boolean;
	/** Where the record's data starts. */
	offset: number;
	length: number;
}

interface TextBlock {
	type: number;
	text: string;
	box: SlideBox | null;
}

const readHeader = (view: DataView, offset: number): RecordHeader | null => {
	if (offset < 0 || offset + 8 > view.byteLength) return null;
	const versionAndInstance = view.getUint16(offset, true);
	return {
		type: view.getUint16(offset + 2, true),
		instance: versionAndInstance >> 4,
		container: (versionAndInstance & 0xf) === 0xf,
		offset: offset + 8,
		length: Math.min(
			view.getUint32(offset + 4, true),
			view.byteLength - offset - 8,
		),
	};
};

const childRecords = (view: DataView, parent: RecordHeader): RecordHeader[] => {
	const records: RecordHeader[] = [];
	const end = parent.offset + parent.length;
	let at = parent.offset;
	while (at + 8 <= end) {
		const record = readHeader(view, at);
		if (!record) break;
		records.push(record);
		at = record.offset + record.length;
	}
	return records;
};

const decodeText = (bytes: Uint8Array, record: RecordHeader): string => {
	const data = bytes.subarray(record.offset, record.offset + record.length);
	if (record.type === RECORD.textCharsAtom) {
		return new TextDecoder("utf-16le").decode(data);
	}
	let text = "";
	for (const byte of data) text += String.fromCharCode(byte);
	return text;
};

/** Persist id → stream offset, newest save first. */
const readPersistDirectory = (
	view: DataView,
	firstEdit: number,
): {
	offsets: Map<number, number>;
	documentRef: number;
	encrypted: boolean;
} => {
	const offsets = new Map<number, number>();
	let documentRef = 0;
	let encrypted = false;
	const visited = new Set<number>();
	let edit = firstEdit;
	while (edit > 0 && !visited.has(edit)) {
		visited.add(edit);
		const atom = readHeader(view, edit);
		if (!atom || atom.type !== RECORD.userEditAtom || atom.length < 20) break;
		if (!documentRef) {
			documentRef = view.getUint32(atom.offset + 16, true);
			// The newest save names its encryption session when it has one.
			encrypted =
				atom.length >= 32 && view.getUint32(atom.offset + 28, true) !== 0;
		}
		const directory = readHeader(view, view.getUint32(atom.offset + 12, true));
		if (directory?.type === RECORD.persistDirectoryAtom) {
			const end = directory.offset + directory.length;
			let at = directory.offset;
			while (at + 4 <= end) {
				const entry = view.getUint32(at, true);
				const first = entry & 0xfffff;
				const count = entry >>> 20;
				at += 4;
				for (let index = 0; index < count && at + 4 <= end; index += 1) {
					if (!offsets.has(first + index)) {
						offsets.set(first + index, view.getUint32(at, true));
					}
					at += 4;
				}
			}
		}
		edit = view.getUint32(atom.offset + 8, true);
	}
	return { offsets, documentRef, encrypted };
};

const anchorBox = (view: DataView, record: RecordHeader): SlideBox | null => {
	let top: number;
	let left: number;
	let right: number;
	let bottom: number;
	if (record.length >= 16) {
		top = view.getInt32(record.offset, true);
		left = view.getInt32(record.offset + 4, true);
		right = view.getInt32(record.offset + 8, true);
		bottom = view.getInt32(record.offset + 12, true);
	} else if (record.length >= 8) {
		top = view.getInt16(record.offset, true);
		left = view.getInt16(record.offset + 2, true);
		right = view.getInt16(record.offset + 4, true);
		bottom = view.getInt16(record.offset + 6, true);
	} else return null;
	if (right <= left || bottom <= top) return null;
	return {
		x: left * EMU_PER_MASTER_UNIT,
		y: top * EMU_PER_MASTER_UNIT,
		width: (right - left) * EMU_PER_MASTER_UNIT,
		height: (bottom - top) * EMU_PER_MASTER_UNIT,
		rotation: 0,
		flipH: false,
		flipV: false,
	};
};

/** Text boxes in a slide's drawing, with their anchors. */
const slideTextBlocks = (
	bytes: Uint8Array,
	view: DataView,
	slide: RecordHeader,
	outline: { type: number; text: string }[],
): TextBlock[] => {
	const blocks: TextBlock[] = [];
	const visit = (record: RecordHeader) => {
		for (const child of childRecords(view, record)) {
			if (child.type === RECORD.shapeContainer) {
				const parts = childRecords(view, child);
				const anchor = parts.find((part) => part.type === RECORD.clientAnchor);
				const textbox = parts.find(
					(part) => part.type === RECORD.clientTextbox,
				);
				if (!textbox) continue;
				let type = 4;
				let text = "";
				for (const part of childRecords(view, textbox)) {
					if (part.type === RECORD.textHeaderAtom && part.length >= 4) {
						type = view.getUint32(part.offset, true);
					} else if (
						part.type === RECORD.textCharsAtom ||
						part.type === RECORD.textBytesAtom
					) {
						text += decodeText(bytes, part);
					} else if (
						part.type === RECORD.outlineTextRefAtom &&
						part.length >= 4
					) {
						const referenced = outline[view.getInt32(part.offset, true)];
						if (referenced) {
							type = referenced.type;
							text += referenced.text;
						}
					}
				}
				if (text.trim()) {
					blocks.push({
						type,
						text,
						box: anchor ? anchorBox(view, anchor) : null,
					});
				}
			} else if (child.container) {
				visit(child);
			}
		}
	};
	visit(slide);
	return blocks;
};

const paragraphsOf = (block: TextBlock): SlideParagraph[] => {
	const title = TITLE_TYPES.has(block.type);
	const size = title ? 36 : 20;
	return block.text
		.replace(/\r\n?/g, "\r")
		.split("\r")
		.map((line) => ({
			align: CENTERED_TYPES.has(block.type) ? "center" : "left",
			level: 0,
			marginLeft: BULLET_TYPES.has(block.type) ? 342900 : 0,
			indent: BULLET_TYPES.has(block.type) ? -342900 : 0,
			bullet:
				BULLET_TYPES.has(block.type) && line.trim()
					? { text: "•", color: "#000000", font: null }
					: null,
			spaceBefore: title ? 0 : size * 0.2,
			spaceAfter: 0,
			lineHeight: 1.2,
			lineHeightPoints: null,
			size,
			runs: line.split("\v").flatMap((part, index) => {
				const run = {
					size,
					bold: false,
					italic: false,
					underline: false,
					strike: false,
					caps: false,
					color: "#000000",
					font: null,
					baseline: 0,
				};
				return index === 0
					? [{ ...run, text: part }]
					: [
							{ ...run, text: "\n" },
							{ ...run, text: part },
						];
			}),
		}));
};

/** Places blocks the slide gives no anchor for: titles on top, the rest below. */
const layoutBlocks = (
	blocks: TextBlock[],
	width: number,
	height: number,
): SlideElement[] => {
	const marginX = width * 0.06;
	const titleBox = {
		x: marginX,
		y: height * 0.05,
		width: width - marginX * 2,
		height: height * 0.17,
	};
	const loose = blocks.filter(
		(block) => !block.box && !TITLE_TYPES.has(block.type),
	);
	const bodyTop = height * 0.25;
	const bodyHeight = (height * 0.7) / Math.max(1, loose.length);
	let looseIndex = 0;
	return blocks.map((block): SlideElement => {
		let box = block.box;
		if (!box) {
			const place = TITLE_TYPES.has(block.type)
				? titleBox
				: {
						x: marginX,
						y: bodyTop + bodyHeight * looseIndex++,
						width: width - marginX * 2,
						height: bodyHeight,
					};
			box = { ...place, rotation: 0, flipH: false, flipV: false };
		}
		return {
			kind: "shape",
			box,
			geometry: { kind: "preset", name: "rect", adjust: {} },
			fill: null,
			line: null,
			placeholder: TITLE_TYPES.has(block.type) ? "title" : "body",
			text: {
				paragraphs: paragraphsOf(block),
				anchor: TITLE_TYPES.has(block.type) ? "middle" : "top",
				insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 },
				wrap: true,
				vertical: "none",
				scale: 1,
			},
		};
	});
};

const toBytes = (content: unknown): Uint8Array | null => {
	if (content instanceof Uint8Array) return content;
	if (Array.isArray(content)) return Uint8Array.from(content as number[]);
	return null;
};

export async function parseLegacyPpt(
	bytes: Uint8Array,
): Promise<PresentationDeck> {
	const { CFB } = await import("xlsx");
	let container: unknown;
	try {
		container = CFB.read(bytes, { type: "array" });
	} catch {
		throw new Error(NOT_A_PRESENTATION);
	}
	if (
		CFB.find(container, "EncryptedPackage") ||
		CFB.find(container, "EncryptedSummary")
	) {
		throw new Error(PASSWORD_PROTECTED);
	}
	const stream = toBytes(CFB.find(container, "PowerPoint Document")?.content);
	if (!stream) throw new Error(NOT_A_PRESENTATION);
	const view = new DataView(
		stream.buffer,
		stream.byteOffset,
		stream.byteLength,
	);
	const currentUser = toBytes(CFB.find(container, "Current User")?.content);
	const firstEdit =
		currentUser && currentUser.byteLength >= 20
			? new DataView(
					currentUser.buffer,
					currentUser.byteOffset,
					currentUser.byteLength,
				).getUint32(16, true)
			: 0;
	const { offsets, documentRef, encrypted } = readPersistDirectory(
		view,
		firstEdit,
	);
	if (encrypted) throw new Error(PASSWORD_PROTECTED);
	const documentRecord = readHeader(view, offsets.get(documentRef) ?? -1);
	const whole: RecordHeader = {
		type: 0,
		instance: 0,
		container: true,
		offset: 0,
		length: stream.byteLength,
	};

	let width = 5760 * EMU_PER_MASTER_UNIT;
	let height = 4320 * EMU_PER_MASTER_UNIT;
	const slideEntries: {
		slide: RecordHeader | null;
		outline: { type: number; text: string }[];
	}[] = [];
	if (documentRecord?.type === RECORD.document) {
		for (const child of childRecords(view, documentRecord)) {
			if (child.type === RECORD.documentAtom && child.length >= 8) {
				width =
					view.getInt32(child.offset, true) * EMU_PER_MASTER_UNIT || width;
				height =
					view.getInt32(child.offset + 4, true) * EMU_PER_MASTER_UNIT || height;
			}
			if (child.type !== RECORD.slideListWithText || child.instance !== 0)
				continue;
			let pendingType = 4;
			for (const record of childRecords(view, child)) {
				if (record.type === RECORD.slidePersistAtom && record.length >= 4) {
					slideEntries.push({
						slide: readHeader(
							view,
							offsets.get(view.getUint32(record.offset, true)) ?? -1,
						),
						outline: [],
					});
				} else if (
					record.type === RECORD.textHeaderAtom &&
					record.length >= 4
				) {
					pendingType = view.getUint32(record.offset, true);
				} else if (
					record.type === RECORD.textCharsAtom ||
					record.type === RECORD.textBytesAtom
				) {
					slideEntries.at(-1)?.outline.push({
						type: pendingType,
						text: decodeText(stream, record),
					});
				}
			}
		}
	}
	// Without a readable directory, take the slides in the order they were saved.
	if (!slideEntries.length) {
		for (const record of childRecords(view, whole)) {
			if (record.type === RECORD.slide)
				slideEntries.push({ slide: record, outline: [] });
		}
	}
	if (!slideEntries.length && !documentRecord)
		throw new Error(NOT_A_PRESENTATION);

	const slides = slideEntries.map(
		({ slide, outline }, index): PresentationSlide => {
			let blocks =
				slide?.type === RECORD.slide
					? slideTextBlocks(stream, view, slide, outline)
					: [];
			if (!blocks.length) {
				blocks = outline
					.filter((entry) => entry.text.trim())
					.map((entry) => ({ ...entry, box: null }));
			}
			return {
				number: index + 1,
				hidden: false,
				background: { kind: "color", color: "#ffffff" },
				elements: layoutBlocks(blocks, width, height),
				notes: "",
			};
		},
	);
	return { width, height, slides, media: {}, textOnly: true };
}
