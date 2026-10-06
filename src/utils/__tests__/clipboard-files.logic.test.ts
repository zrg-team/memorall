import { describe, expect, it } from "vitest";
import {
	imageExtension,
	imageFromText,
	pastedFiles,
} from "@/utils/clipboard-files";

/** A 1×1 PNG. */
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const clipboard = (
	content: {
		text?: string;
		html?: string;
		files?: File[];
		items?: Array<{ kind: string; getAsFile: () => File | null }>;
	} = {},
) =>
	({
		files: content.files ?? [],
		items: content.items ?? [],
		types: [
			...(content.text !== undefined ? ["text/plain"] : []),
			...(content.html !== undefined ? ["text/html"] : []),
			...(content.files?.length ? ["Files"] : []),
		],
		getData: (type: string) =>
			type === "text/plain"
				? (content.text ?? "")
				: type === "text/html"
					? (content.html ?? "")
					: "",
	}) as unknown as DataTransfer;

const bytesOf = async (file: File) =>
	Array.from(new Uint8Array(await file.arrayBuffer()));

describe("pastedFiles", () => {
	it("takes a pasted picture and files copied in a file manager", () => {
		const shot = new File([new Uint8Array([1])], "image.png", {
			type: "image/png",
		});
		expect(pastedFiles(clipboard({ files: [shot] }))).toEqual([shot]);

		const report = new File(["text"], "report.pdf", {
			type: "application/pdf",
		});
		// A file manager names the file in the text too.
		expect(
			pastedFiles(clipboard({ text: "report.pdf", files: [report] })),
		).toEqual([report]);
	});

	it("reads the files from the items when the list is empty", () => {
		const shot = new File([new Uint8Array([1])], "image.png", {
			type: "image/png",
		});
		expect(
			pastedFiles(
				clipboard({
					items: [
						{ kind: "string", getAsFile: () => null },
						{ kind: "file", getAsFile: () => shot },
					],
				}),
			),
		).toEqual([shot]);
	});

	it("keeps the text of a document app's selection, not its picture", () => {
		const rendering = new File([new Uint8Array([1])], "image.png", {
			type: "image/png",
		});
		const cells = clipboard({
			text: "a\tb\n1\t2",
			html: "<style>td { color: red }</style><!--StartFragment--><table><tr><td>a</td><td>b</td></tr></table>",
			files: [rendering],
		});
		expect(pastedFiles(cells)).toEqual([]);

		// A browser's "Copy image": its HTML is only the picture.
		const copied = clipboard({
			text: "",
			html: '<meta charset="utf-8"><img src="https://example.com/cat.png">',
			files: [rendering],
		});
		expect(pastedFiles(copied)).toEqual([rendering]);
	});

	it("turns an image pasted as text into a file", async () => {
		const [file] = pastedFiles(
			clipboard({ text: `data:image/png;base64,${PNG_BASE64}` }),
		);
		expect(file?.name).toBe("image.png");
		expect(file?.type).toBe("image/png");
		expect((await bytesOf(file!)).slice(0, 4)).toEqual([
			0x89, 0x50, 0x4e, 0x47,
		]);
	});

	it("leaves text alone", () => {
		expect(pastedFiles(clipboard({ text: "hello world" }))).toEqual([]);
		expect(pastedFiles(null)).toEqual([]);
	});
});

describe("imageFromText", () => {
	it("reads base64 and percent-encoded image data URLs", async () => {
		const png = imageFromText(`  data:image/png;base64,${PNG_BASE64}\n`);
		expect(png?.type).toBe("image/png");
		expect(png?.size).toBe(atob(PNG_BASE64).length);

		const svg = imageFromText(
			"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
		);
		expect(svg?.name).toBe("image.svg");
		expect(await svg?.text()).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
	});

	it("knows bare base64 of a picture by its first bytes, line breaks and all", () => {
		const wrapped = PNG_BASE64.replace(/(.{40})/g, "$1\r\n");
		const png = imageFromText(wrapped);
		expect(png?.type).toBe("image/png");
		expect(png?.size).toBe(atob(PNG_BASE64).length);

		const jpeg = imageFromText(`/9j/4AAQSkZJRgABAQAAAQABAAD${"A".repeat(20)}`);
		expect(jpeg?.type).toBe("image/jpeg");
		expect(jpeg?.name).toBe("image.jpg");
	});

	it("is null for base64 that is not a picture, and for broken data URLs", () => {
		expect(imageFromText(btoa("just some words, encoded"))).toBeNull();
		expect(imageFromText("data:text/plain;base64,aGVsbG8=")).toBeNull();
		expect(imageFromText("data:image/png;base64,***")).toBeNull();
		expect(imageFromText("data:image/png;base64,")).toBeNull();
		expect(imageFromText("iVBORw0KGgo")).toBeNull();
	});
});

describe("imageExtension", () => {
	it("names known types and falls back to the subtype", () => {
		expect(imageExtension("image/png")).toBe(".png");
		expect(imageExtension("image/jpeg")).toBe(".jpg");
		expect(imageExtension("image/svg+xml")).toBe(".svg");
		expect(imageExtension("")).toBe(".png");
	});
});
