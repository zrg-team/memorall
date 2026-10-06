import {
	base64ToBytes,
	mimeTypeToExtension,
} from "@/services/llm/utils/media-encoding";

/**
 * What a paste carries besides text: files copied in a file manager, a
 * picture (a screenshot, a browser's "Copy image"), or a picture pasted as
 * text, as an image data URL or bare base64. Empty for a text paste.
 */
export function pastedFiles(data: DataTransfer | null | undefined): File[] {
	if (!data) return [];
	const text = data.getData("text/plain") ?? "";
	const files = transferFiles(data);
	if (files.length > 0) {
		// A selection in a document app (spreadsheet cells, a paragraph) also
		// carries a picture of itself: its text is what was copied.
		const isDocumentSelection =
			text.trim() !== "" &&
			htmlHasText(data.getData("text/html") ?? "") &&
			files.every((file) => file.type.startsWith("image/"));
		return isDocumentSelection ? [] : files;
	}
	const image = imageFromText(text);
	return image ? [image] : [];
}

/** A picture written as text: an image data URL, or bare base64 of one. */
export function imageFromText(text: string): File | null {
	const value = text.trim();
	if (!value) return null;
	return value.startsWith("data:")
		? imageFromDataUrl(value)
		: imageFromBase64(value);
}

/** `.png` for image/png; the subtype for the rest (image/svg+xml → `.svg`). */
export function imageExtension(mimeType: string): string {
	const known = mimeTypeToExtension(mimeType);
	if (known) return known;
	const subtype = mimeType.split("/")[1]?.split(/[+;]/)[0]?.trim();
	return subtype ? `.${subtype.replace(/^x-/, "")}` : ".png";
}

const transferFiles = (data: DataTransfer): File[] => {
	const files = Array.from(data.files ?? []);
	if (files.length > 0) return files;
	return Array.from(data.items ?? [])
		.filter((item) => item.kind === "file")
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
};

const htmlHasText = (html: string): boolean =>
	html
		.replace(/<(style|script|xml)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;|&#160;/gi, " ")
		.trim() !== "";

const DATA_URL = /^data:(image\/[\w.+-]+)((?:;[\w.+-]+(?:=[^;,]*)?)*),/i;

const imageFromDataUrl = (value: string): File | null => {
	const match = DATA_URL.exec(value);
	if (!match) return null;
	const mimeType = match[1].toLowerCase();
	const body = value.slice(match[0].length);
	try {
		const bytes = /;base64$/i.test(match[2])
			? base64ToBytes(body.replace(/\s+/g, ""))
			: new TextEncoder().encode(decodeURIComponent(body));
		return bytes.length > 0 ? imageFile(bytes, mimeType) : null;
	} catch {
		return null;
	}
};

/** Common picture formats by their first bytes, as `[offset, bytes]` parts. */
const IMAGE_SIGNATURES: Array<[string, Array<[number, number[]]>]> = [
	["image/png", [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]]],
	["image/jpeg", [[0, [0xff, 0xd8, 0xff]]]],
	["image/gif", [[0, [0x47, 0x49, 0x46, 0x38]]]],
	[
		"image/webp",
		[
			[0, [0x52, 0x49, 0x46, 0x46]],
			[8, [0x57, 0x45, 0x42, 0x50]],
		],
	],
];
/** Base64 characters that hold every signature's bytes. */
const SIGNATURE_CHARS = 16;

const sniffImage = (bytes: Uint8Array): string | undefined =>
	IMAGE_SIGNATURES.find(([, parts]) =>
		parts.every(([offset, expected]) =>
			expected.every((byte, index) => bytes[offset + index] === byte),
		),
	)?.[0];

const imageFromBase64 = (value: string): File | null => {
	const compact = value.replace(/\s+/g, "");
	if (
		compact.length <= SIGNATURE_CHARS ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)
	) {
		return null;
	}
	try {
		// The first bytes say whether it is a picture before all of it is decoded.
		const mimeType = sniffImage(
			base64ToBytes(compact.slice(0, SIGNATURE_CHARS)),
		);
		return mimeType ? imageFile(base64ToBytes(compact), mimeType) : null;
	} catch {
		return null;
	}
};

const imageFile = (bytes: Uint8Array, mimeType: string): File =>
	new File([bytes as BlobPart], `image${imageExtension(mimeType)}`, {
		type: mimeType,
	});
