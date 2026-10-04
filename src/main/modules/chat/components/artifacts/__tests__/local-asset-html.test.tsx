import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readMediaFile = vi.hoisted(() => vi.fn());

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readMediaFile },
}));
vi.mock("@/utils/logger", () => ({ logWarn: vi.fn() }));

import {
	findLocalAssetRefs,
	rewriteLocalAssets,
	usePreparedArtifactHtml,
} from "../local-asset-html";

const DIR = "/projects/house-review";

describe("files shown in an HTML artifact", () => {
	// A block body: a function returned from beforeEach is run as its cleanup,
	// and mockReset returns the mock itself.
	beforeEach(() => {
		readMediaFile.mockReset();
	});

	it("finds full Files paths and leaves web URLs alone", () => {
		const refs = findLocalAssetRefs(`
<img src="${DIR}/photo-00.jpg" alt="Front">
<img src='${DIR}/photo-01.jpg?v=2'>
<img src="https://file4.batdongsan.com.vn/a.jpg">
<img src="//cdn.example.com/b.jpg">
<img src="data:image/png;base64,AAAA">
<video poster="${DIR}/cover.png"><source src="/media/tour.mp4"></video>
<div style="background:url('${DIR}/bg.webp')"></div>`);

		expect([...refs.keys()]).toEqual([
			`${DIR}/photo-00.jpg`,
			`${DIR}/photo-01.jpg`,
			`${DIR}/cover.png`,
			"/media/tour.mp4",
			`${DIR}/bg.webp`,
		]);
	});

	it("places a relative name where the page itself gives its full path", () => {
		// What the agent wrote: a relative name, the full path in a fallback.
		const html = `<img src="photo-00.jpg" onerror="this.onerror=null;this.src='${DIR}/photo-00.jpg'">
<img src="photo-01.jpg">`;

		const refs = findLocalAssetRefs(html);
		expect(refs.get("photo-00.jpg")).toBe(`${DIR}/photo-00.jpg`);
		// Nothing says where photo-01.jpg is: left alone.
		expect(refs.has("photo-01.jpg")).toBe(false);
	});

	it("places relative names under the artifact's project folder", () => {
		const refs = findLocalAssetRefs(
			'<img src="photo-00.jpg"><img src="./img/a.png"><a href="next.html">',
			DIR,
		);
		expect(Object.fromEntries(refs)).toEqual({
			"photo-00.jpg": `${DIR}/photo-00.jpg`,
			"./img/a.png": `${DIR}/img/a.png`,
		});
	});

	it("loads a script written beside the page, like plotly's library", async () => {
		// What plotly writes with include_plotlyjs="directory".
		const html =
			'<script charset="utf-8" src="plotly.min.js"></script><script src="https://cdn.example.com/x.js"></script>';
		expect(Object.fromEntries(findLocalAssetRefs(html, DIR))).toEqual({
			"plotly.min.js": `${DIR}/plotly.min.js`,
		});

		readMediaFile.mockResolvedValue(new Uint8Array([1]));
		const { result } = renderHook(() => usePreparedArtifactHtml(html, DIR));
		await waitFor(() => expect(result.current.ready).toBe(true));
		expect(result.current.assets).toEqual([
			{
				token: "memorall-asset://0/",
				bytes: new Uint8Array([1]),
				mime: "text/javascript",
			},
		]);
		expect(result.current.html).toContain('src="memorall-asset://0/"');
		expect(result.current.html).toContain('src="https://cdn.example.com/x.js"');
	});

	it("swaps every place the page names a file it has", () => {
		const html = `<img src="photo-00.jpg" onerror="this.src='${DIR}/photo-00.jpg'">
<script>var all = ["${DIR}/photo-00.jpg", "${DIR}/photo-09.jpg"];</script>`;
		const out = rewriteLocalAssets(
			html,
			new Map([
				["photo-00.jpg", "memorall-asset://0/"],
				[`${DIR}/photo-00.jpg`, "memorall-asset://0/"],
			]),
		);
		expect(
			out,
		).toBe(`<img src="memorall-asset://0/" onerror="this.src='memorall-asset://0/'">
<script>var all = ["memorall-asset://0/", "${DIR}/photo-09.jpg"];</script>`);
	});

	it("reads each file once and hands it over with the page", async () => {
		readMediaFile.mockImplementation(async (path: string) => {
			if (path.endsWith("photo-00.jpg")) return new Uint8Array([0xff, 0xd8]);
			throw new Error(`File not found: ${path}`);
		});

		const html = `<img src="photo-00.jpg" onerror="this.src='${DIR}/photo-00.jpg'"><img src="${DIR}/gone.jpg">`;
		const { result } = renderHook(() => usePreparedArtifactHtml(html));
		expect(result.current.ready).toBe(false);
		await waitFor(() => expect(result.current.ready).toBe(true));

		expect(readMediaFile).toHaveBeenCalledTimes(2);
		expect(result.current.assets).toEqual([
			{
				token: "memorall-asset://0/",
				bytes: new Uint8Array([0xff, 0xd8]),
				mime: "image/jpeg",
			},
		]);
		expect(result.current.html).toBe(
			`<img src="memorall-asset://0/" onerror="this.src='memorall-asset://0/'"><img src="${DIR}/gone.jpg">`,
		);
	});

	it("shows a page without Files references at once", () => {
		const { result } = renderHook(() =>
			usePreparedArtifactHtml('<img src="https://example.com/a.png">'),
		);
		expect(result.current).toMatchObject({
			ready: true,
			html: '<img src="https://example.com/a.png">',
			assets: [],
		});
		expect(readMediaFile).not.toHaveBeenCalled();
	});
});
