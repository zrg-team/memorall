import { describe, expect, it } from "vitest";
import {
	extractElementSource,
	extractElementText,
	MAX_ELEMENT_TEXT_CHARS,
} from "../readable-text";

const el = (html: string): Element => {
	const host = document.createElement("div");
	host.innerHTML = html;
	return host.firstElementChild as Element;
};

describe("extractElementText", () => {
	it("returns nothing for an image a page stuffed bytes into", () => {
		// batdongsan.com.vn hangs the raw JPEG of every photo under its <img>.
		// Thirty of those filled a one-million-token context with binary garbage.
		const image = el("<img title='photo'>");
		image.appendChild(document.createTextNode("ÿØÿJFIF...binary..."));

		expect(extractElementText(image)).toBe("");
	});

	it("keeps real text, with the layout squeezed out", () => {
		expect(extractElementText(el("<p>  hello \n\n   world  </p>"))).toBe(
			"hello world",
		);
	});

	it("drops scripts and styles a container happens to hold", () => {
		const node = el(
			"<div>Price<script>var a=1</script><style>.x{}</style> 9.79</div>",
		);
		expect(extractElementText(node)).toBe("Price 9.79");
	});

	it("drops bytes stuffed into a nested image without losing the caption", () => {
		const node = el("<figure><img><figcaption>Yen Do</figcaption></figure>");
		node
			.querySelector("img")
			?.appendChild(document.createTextNode("JFIFbytes"));

		expect(extractElementText(node)).toBe("Yen Do");
	});

	it("caps a long run so one element cannot flood the result", () => {
		const node = el(`<div>${"word ".repeat(2_000)}</div>`);
		const text = extractElementText(node);

		expect(text.length).toBeLessThanOrEqual(MAX_ELEMENT_TEXT_CHARS + 20);
		expect(text.endsWith("[truncated]")).toBe(true);
	});
});

describe("extractElementSource", () => {
	it("returns a normal src unchanged, so it can be fetched", () => {
		expect(extractElementSource(el("<img src='https://x.test/a.jpg'>"))).toBe(
			"https://x.test/a.jpg",
		);
	});

	it("summarises an inline data url instead of carrying the image", () => {
		const inline = `data:image/jpeg;base64,${"A".repeat(50_000)}`;
		const result = extractElementSource(el(`<img src="${inline}">`));

		expect(result).toContain("data:image/jpeg");
		expect(result).toContain("inline");
		expect(result).not.toContain("AAAA");
		expect((result ?? "").length).toBeLessThan(80);
	});

	it("falls back to lazy-loading attributes", () => {
		expect(
			extractElementSource(el("<img data-src='https://x.test/b.png'>")),
		).toBe("https://x.test/b.png");
		expect(
			extractElementSource(
				el("<img srcset='https://x.test/c.png 1x, https://x.test/d.png 2x'>"),
			),
		).toBe("https://x.test/c.png");
	});

	it("returns null when there is no source at all", () => {
		expect(extractElementSource(el("<div>text</div>"))).toBeNull();
	});
});
