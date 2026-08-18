import { describe, expect, it } from "vitest";
import { resolveWebSearchEngines } from "./web-search-engine";

describe("web_search engine normalization", () => {
	it("uses a resilient multi-engine default", () => {
		expect(resolveWebSearchEngines(undefined)).toEqual([
			"duckduckgo",
			"brave",
			"bing",
		]);
	});

	it("accepts comma-separated strings and arrays without duplicates", () => {
		expect(resolveWebSearchEngines("Brave, bing,brave")).toEqual([
			"brave",
			"bing",
		]);
		expect(resolveWebSearchEngines(["duckduckgo", "google"])).toEqual([
			"duckduckgo",
			"google",
		]);
	});

	it("expands all and falls back when every value is unsupported", () => {
		expect(resolveWebSearchEngines(["all"])).toEqual([
			"google",
			"bing",
			"duckduckgo",
			"yahoo",
			"brave",
		]);
		expect(resolveWebSearchEngines(["made-up"])).toEqual([
			"duckduckgo",
			"brave",
			"bing",
		]);
	});
});
