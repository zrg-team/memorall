import { describe, expect, it } from "vitest";
import { downloadFileName, formatDownloadSize } from "../download";

describe("downloadFileName", () => {
	it("keeps the address's name and adds the extension its type has", () => {
		expect(
			downloadFileName("https://a.test/img/hero.jpg?w=800", "image/jpeg"),
		).toBe("hero.jpg");
		expect(downloadFileName("https://a.test/img/hero", "image/webp")).toBe(
			"hero.webp",
		);
		expect(downloadFileName("https://a.test/", "image/png")).toBe(
			"download.png",
		);
		expect(
			downloadFileName("https://a.test/fonts/Be%20Vietnam.ttf", "font/ttf"),
		).toBe("Be Vietnam.ttf");
		expect(downloadFileName("https://a.test/a:b", "")).toBe("a-b");
	});

	it("reads sizes the way a person does", () => {
		expect(formatDownloadSize(512)).toBe("512 B");
		expect(formatDownloadSize(24 * 1024)).toBe("24 KB");
		expect(formatDownloadSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
	});
});
