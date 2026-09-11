import { describe, expect, it } from "vitest";
import { extractMessageLinks } from "../message-links";

describe("extractMessageLinks", () => {
	it("finds a url pasted with an instruction after it", () => {
		// The shape that prompted the feature: a link and a trailing note, no space.
		expect(
			extractMessageLinks(
				"https://batdongsan.com.vn/ban-nha-pr46112113 please noted this",
			),
		).toEqual(["https://batdongsan.com.vn/ban-nha-pr46112113"]);
	});

	it("keeps a markdown link's target, not its label", () => {
		expect(
			extractMessageLinks("see [the listing](https://example.com/a)"),
		).toEqual(["https://example.com/a"]);
	});

	it("drops sentence punctuation but keeps balanced brackets in a path", () => {
		expect(extractMessageLinks("read https://example.com/a.")).toEqual([
			"https://example.com/a",
		]);
		expect(
			extractMessageLinks("https://en.wikipedia.org/wiki/Foo_(bar) is it"),
		).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
	});

	it("ignores urls inside code, which the user is quoting rather than visiting", () => {
		expect(extractMessageLinks("run `curl https://example.com/a`")).toEqual([]);
		expect(
			extractMessageLinks("```\nfetch('https://example.com/a')\n```"),
		).toEqual([]);
	});

	it("deduplicates and caps the list", () => {
		const content = [
			"https://a.example.com/1",
			"https://a.example.com/1",
			"https://b.example.com/2",
			"https://c.example.com/3",
			"https://d.example.com/4",
		].join(" ");
		expect(extractMessageLinks(content)).toEqual([
			"https://a.example.com/1",
			"https://b.example.com/2",
			"https://c.example.com/3",
		]);
	});

	it("ignores non-http schemes and bare words", () => {
		expect(
			extractMessageLinks("mailto:me@example.com and ftp://x.example.com/f"),
		).toEqual([]);
		expect(extractMessageLinks("just talking about example.com")).toEqual([]);
	});
});
