import { describe, expect, it } from "vitest";
import {
	extractReadableDocumentText,
	removeNonReadableNodes,
} from "../readable-text";

const JPEG_BYTES = "ÿØÿàJFIF";

const buildListingDocument = (): Document => {
	document.body.innerHTML = `
		<script>window.__x = 1;</script>
		<style>.a { color: red }</style>
		<h1>Nhà phố 4,3m x 20m</h1>
		<ul class="swiper-wrapper">
			<li><img class="pr-img" src="a.jpg" alt="photo"></li>
			<li><img class="pr-img" src="b.jpg" alt="photo"></li>
		</ul>
		<p>Giá 8 tỷ</p>
	`;
	// Void elements cannot get children from the parser, only from scripts.
	for (const img of document.querySelectorAll("img")) {
		img.appendChild(document.createTextNode(JPEG_BYTES.repeat(1000)));
	}
	return document;
};

describe("extractReadableDocumentText", () => {
	it("drops text that a page script attached under void elements", () => {
		const text = extractReadableDocumentText(buildListingDocument());

		expect(text).toContain("Nhà phố 4,3m x 20m");
		expect(text).toContain("Giá 8 tỷ");
		expect(text).not.toContain("JFIF");
		expect(text).not.toContain("window.__x");
		expect(text).not.toContain("color: red");
		expect(text.length).toBeLessThan(200);
	});

	it("leaves the live document untouched", () => {
		const doc = buildListingDocument();
		extractReadableDocumentText(doc);

		expect(doc.querySelectorAll("script")).toHaveLength(1);
		expect(doc.querySelector("img")?.textContent).toContain("JFIF");
	});
});

describe("removeNonReadableNodes", () => {
	it("keeps void elements themselves, only emptying them", () => {
		const doc = buildListingDocument();
		removeNonReadableNodes(doc);

		expect(doc.querySelectorAll("img")).toHaveLength(2);
		expect(doc.querySelector("img")?.getAttribute("alt")).toBe("photo");
		expect(doc.querySelector("img")?.childNodes).toHaveLength(0);
		expect(doc.querySelector("script")).toBeNull();
	});
});
