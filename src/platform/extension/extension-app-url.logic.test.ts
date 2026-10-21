import { afterEach, describe, expect, it, vi } from "vitest";
import { extensionAppUrl } from "./extension-app-url";

afterEach(() => vi.unstubAllGlobals());

describe("packaged extension app links", () => {
	for (const manifest of [
		{ options_page: "standalone.html" },
		{ options_page: "options/index.html" },
		{ options_ui: { page: "options/index.html" } },
	]) {
		it(`uses the configured page ${JSON.stringify(manifest)}`, () => {
			vi.stubGlobal("chrome", {
				runtime: {
					getManifest: () => manifest,
					getURL: (path: string) => `chrome-extension://extension/${path}`,
				},
			});
			const url = new URL(extensionAppUrl("/?transcript=recording-id"));
			expect(url.pathname).toBe(
				`/${manifest.options_ui?.page ?? manifest.options_page}`,
			);
			expect(url.hash).toBe("#/?transcript=recording-id");
		});
	}
});
