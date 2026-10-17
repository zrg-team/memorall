import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		readFile: vi.fn(),
		onFilesystemChanged: vi.fn(() => () => undefined),
	},
}));
vi.mock("../composition-html", () => ({
	normalizeHyperframesHtml: vi.fn(async (html: string) => ({
		html,
		inlineScripts: [],
	})),
}));

import { normalizeHyperframesHtml } from "../composition-html";
import {
	changeTouchesProject,
	prepareHyperframesComposition,
} from "../use-hyperframes-composition";

describe("changeTouchesProject", () => {
	const project = "/projects/launch";

	it("follows the project's own files", () => {
		expect(
			changeTouchesProject(
				{
					scope: "documents",
					operation: "write",
					path: `${project}/index.html`,
				},
				project,
			),
		).toBe(true);
		expect(
			changeTouchesProject(
				{
					scope: "documents",
					operation: "write",
					path: `${project}/resources/images/hero.jpg`,
				},
				project,
			),
		).toBe(true);
	});

	it("ignores exports into the renders folder and other projects", () => {
		expect(
			changeTouchesProject(
				{
					scope: "documents",
					operation: "create",
					path: `${project}/renders/launch.mp4`,
				},
				project,
			),
		).toBe(false);
		expect(
			changeTouchesProject(
				{
					scope: "documents",
					operation: "write",
					path: "/projects/launcher/index.html",
				},
				project,
			),
		).toBe(false);
	});

	it("looks inside batches and treats an unknown change as a change", () => {
		expect(
			changeTouchesProject(
				{
					scope: "documents",
					operation: "batch",
					changes: [
						{
							scope: "documents",
							operation: "write",
							path: "/elsewhere/a.txt",
						},
						{
							scope: "documents",
							operation: "write",
							path: `${project}/index.html`,
						},
					],
				},
				project,
			),
		).toBe(true);
		expect(changeTouchesProject(null, project)).toBe(true);
	});
});

describe("prepareHyperframesComposition", () => {
	it("prepares a composition once while it is unchanged", async () => {
		vi.mocked(normalizeHyperframesHtml).mockClear();
		const first = await prepareHyperframesComposition(
			"<p>a</p>",
			"/projects/x",
		);
		const again = await prepareHyperframesComposition(
			"<p>a</p>",
			"/projects/x",
		);
		expect(again).toBe(first);
		expect(normalizeHyperframesHtml).toHaveBeenCalledTimes(1);

		await prepareHyperframesComposition("<p>b</p>", "/projects/x");
		expect(normalizeHyperframesHtml).toHaveBeenCalledTimes(2);
	});
});
