import { describe, expect, it } from "vitest";
import { memonContentKind, memonFileKind } from "../file-kinds";

const bytesOf = (...values: Array<number | string>) =>
	new Uint8Array(
		values.flatMap((value) =>
			typeof value === "string"
				? [...new TextEncoder().encode(value)]
				: [value],
		),
	);

describe("memon file kinds", () => {
	it("goes by the extension, and takes an unknown one for text", () => {
		expect(memonFileKind("/a/report.PDF")).toBe("pdf");
		expect(memonFileKind("/a/notes.md")).toBe("text");
		expect(memonFileKind("/a/2610.32253")).toBe("text");
	});

	it("tells a file whose name says nothing by its bytes", () => {
		expect(memonContentKind(bytesOf("%PDF-1.7\n"))).toBe("pdf");
		expect(memonContentKind(bytesOf(0x89, "PNG\r\n"))).toBe("image");
		expect(memonContentKind(bytesOf("PK", 3, 4, "rest"))).toBe("binary");
		expect(memonContentKind(bytesOf("abc", 0, "def"))).toBe("binary");
		expect(memonContentKind(bytesOf("# Notes\nplain text"))).toBe("text");
		expect(memonContentKind(new Uint8Array())).toBe("text");
	});
});
