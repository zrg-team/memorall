import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/current", () => ({ platform: { environment: "web" } }));
vi.mock("../local-asset-html", () => ({ usePreparedArtifactHtml: vi.fn() }));

import { FRAME_PAGE_INDEX } from "../HtmlArtifactFrame";

describe("the HTML artifact page", () => {
	it("is the sandbox page the frame looks for once builds rename them", () => {
		const manifest = JSON.parse(
			readFileSync(resolve(process.cwd(), "manifest.base.json"), "utf8"),
		) as { sandbox: { pages: string[] } };
		expect(manifest.sandbox.pages[FRAME_PAGE_INDEX]).toBe(
			"sandbox/pages/html-artifact.html",
		);
		// The sandbox runtime falls back to the last page: it must stay last.
		expect(manifest.sandbox.pages.at(-1)).toContain(
			"sandbox-container-runtime",
		);
	});
});
