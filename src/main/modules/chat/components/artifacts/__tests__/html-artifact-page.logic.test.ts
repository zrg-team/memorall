import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/current", () => ({ platform: { environment: "web" } }));
vi.mock("../local-asset-html", () => ({ usePreparedArtifactHtml: vi.fn() }));

import { FRAME_PAGE_INDEX } from "../HtmlArtifactFrame";
import { HYPERFRAMES_PREVIEW_PAGE_INDEX } from "../hyperframes/HyperframesPlayer";

const sandboxPages = () =>
	(
		JSON.parse(
			readFileSync(resolve(process.cwd(), "manifest.base.json"), "utf8"),
		) as { sandbox: { pages: string[] } }
	).sandbox.pages;

describe("the HTML artifact page", () => {
	it("is the sandbox page the frame looks for once builds rename them", () => {
		const pages = sandboxPages();
		expect(pages[FRAME_PAGE_INDEX]).toBe("sandbox/pages/html-artifact.html");
		// The sandbox runtime falls back to the last page: it must stay last.
		expect(pages.at(-1)).toContain("sandbox-container-runtime");
	});

	it("lists the HyperFrames preview where the player looks for it", () => {
		// An unlisted page is an ordinary extension page, whose policy blocks
		// the composition's inline timeline: the video would never move.
		expect(sandboxPages()[HYPERFRAMES_PREVIEW_PAGE_INDEX]).toBe(
			"sandbox/pages/hyperframes-preview.html",
		);
	});
});
