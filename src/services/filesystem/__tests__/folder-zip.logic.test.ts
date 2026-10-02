import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type FolderZipFileSystem, zipFolder } from "../folder-zip";

/** Files as path → content; a path ending in "/" is an empty folder. */
const memoryFs = (files: Record<string, string | Uint8Array>) => {
	const isDir = (path: string) =>
		Object.keys(files).some(
			(key) => key.startsWith(`${path}/`) || key === `${path}/`,
		);
	return {
		async stat(path: string) {
			const dir = isDir(path);
			if (!dir && !(path in files)) throw new Error(`ENOENT ${path}`);
			return { isDirectory: () => dir, isFile: () => !dir };
		},
		async readdir(dir: string) {
			const names = new Set<string>();
			for (const key of Object.keys(files)) {
				if (!key.startsWith(`${dir}/`)) continue;
				const rest = key.slice(dir.length + 1);
				if (rest) names.add(rest.split("/")[0]);
			}
			return [...names].map((name) => {
				const path = `${dir}/${name}`;
				const dirEntry = isDir(path);
				return {
					name,
					isDirectory: () => dirEntry,
					isFile: () => !dirEntry,
					isSymbolicLink: () => false,
				};
			});
		},
		async readFile(path: string) {
			const value = files[path];
			return typeof value === "string" ? strToU8(value) : value;
		},
	} as unknown as FolderZipFileSystem;
};

const SITE = "/projects/van-thang-marketing";

describe("a folder as a zip", () => {
	it("holds every file under the folder's own name", async () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
		const fs = memoryFs({
			[`${SITE}/index.html`]: "<h1>Văn Thắng</h1>",
			[`${SITE}/server.js`]: "console.log(1)",
			[`${SITE}/assets/logo.jpg`]: jpeg,
			[`${SITE}/research/notes/a.md`]: "# A",
			[`${SITE}/drafts/`]: "",
			"/projects/other/x.txt": "not this",
		});

		const zip = await zipFolder(fs, SITE);

		expect(zip.name).toBe("van-thang-marketing.zip");
		expect(zip.fileCount).toBe(4);
		const entries = unzipSync(zip.bytes);
		const names = Object.keys(entries);
		expect(names.filter((name) => !name.endsWith("/")).sort()).toEqual([
			"van-thang-marketing/assets/logo.jpg",
			"van-thang-marketing/index.html",
			"van-thang-marketing/research/notes/a.md",
			"van-thang-marketing/server.js",
		]);
		// The empty folder keeps its place.
		expect(names).toContain("van-thang-marketing/drafts/");
		expect(strFromU8(entries["van-thang-marketing/index.html"])).toBe(
			"<h1>Văn Thắng</h1>",
		);
		expect(entries["van-thang-marketing/assets/logo.jpg"]).toEqual(jpeg);
	});

	it("refuses a file, and a folder too big to hold in memory", async () => {
		const fs = memoryFs({
			[`${SITE}/a.bin`]: new Uint8Array(600),
			[`${SITE}/b.bin`]: new Uint8Array(600),
		});
		await expect(zipFolder(fs, `${SITE}/a.bin`)).rejects.toThrow(
			"is not a folder",
		);
		await expect(zipFolder(fs, SITE, { maxBytes: 1_000 })).rejects.toThrow(
			"zip a smaller folder",
		);
	});
});
