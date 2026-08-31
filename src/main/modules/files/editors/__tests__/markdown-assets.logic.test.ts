import { describe, expect, it } from "vitest";
import {
	imageMimeFor,
	isDirectlyLoadable,
	resolveMarkdownAssetPath,
} from "../markdown-assets";

describe("resolveMarkdownAssetPath", () => {
	it("resolves a sibling image against the markdown file's folder", () => {
		expect(resolveMarkdownAssetPath("/notes/game/page.md", "banner.webp")).toBe(
			"/notes/game/banner.webp",
		);
	});

	it("resolves ./ and ../ references", () => {
		expect(
			resolveMarkdownAssetPath("/notes/game/page.md", "./img/map.webp"),
		).toBe("/notes/game/img/map.webp");
		expect(
			resolveMarkdownAssetPath("/notes/game/page.md", "../shared/qr.png"),
		).toBe("/notes/shared/qr.png");
	});

	it("keeps absolute filesystem paths as written", () => {
		expect(resolveMarkdownAssetPath("/notes/game/page.md", "/logo.png")).toBe(
			"/logo.png",
		);
	});

	it("drops query strings, fragments, and percent-encoding", () => {
		expect(
			resolveMarkdownAssetPath("/notes/page.md", "my%20image.png?v=2#top"),
		).toBe("/notes/my image.png");
	});

	it("returns null for an empty reference", () => {
		expect(resolveMarkdownAssetPath("/notes/page.md", "   ")).toBeNull();
		expect(resolveMarkdownAssetPath("/notes/page.md", "#anchor")).toBeNull();
	});
});

describe("isDirectlyLoadable", () => {
	it("recognises sources the browser can fetch itself", () => {
		for (const src of [
			"https://example.com/a.png",
			"http://example.com/a.png",
			"data:image/png;base64,AAAA",
			"blob:chrome-extension://abc/1",
			"chrome-extension://abc/icon.png",
		]) {
			expect(isDirectlyLoadable(src)).toBe(true);
		}
	});

	it("treats document-relative paths as local assets", () => {
		expect(isDirectlyLoadable("banner.webp")).toBe(false);
		expect(isDirectlyLoadable("/notes/banner.webp")).toBe(false);
		expect(isDirectlyLoadable("./img/a.png")).toBe(false);
	});
});

describe("imageMimeFor", () => {
	it("maps known image extensions", () => {
		expect(imageMimeFor("/a/banner.webp")).toBe("image/webp");
		expect(imageMimeFor("/a/photo.JPG")).toBe("image/jpeg");
		expect(imageMimeFor("/a/icon.svg")).toBe("image/svg+xml");
	});

	it("falls back for unknown extensions", () => {
		expect(imageMimeFor("/a/file.bin")).toBe("application/octet-stream");
	});
});
