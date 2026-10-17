import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
	extractPercent,
	extractZip,
	type FolderZipFileSystem,
	type ZipExtractProgress,
	type ZipExtractFileSystem,
	zipFolder,
} from "../folder-zip";

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

/** A folder holding `files`, which extractZip writes into. */
const writableFs = (files: Record<string, Uint8Array>, dirs: string[]) => {
	const store = new Map(Object.entries(files));
	const folders = new Set(dirs);
	const fs = {
		async stat(path: string) {
			const dir = folders.has(path);
			if (!dir && !store.has(path)) throw new Error(`ENOENT ${path}`);
			return { isDirectory: () => dir, isFile: () => !dir };
		},
		async readFile(path: string) {
			const value = store.get(path);
			if (!value) throw new Error(`ENOENT ${path}`);
			return value;
		},
		async writeFile(path: string, data: Uint8Array) {
			if (!folders.has(path.replace(/\/[^/]*$/, ""))) {
				throw new Error(`ENOENT parent of ${path}`);
			}
			store.set(path, data);
		},
		async mkdir(path: string) {
			const parts = path.split("/").filter(Boolean);
			for (let i = 1; i <= parts.length; i++) {
				folders.add(`/${parts.slice(0, i).join("/")}`);
			}
			return undefined;
		},
	} as unknown as ZipExtractFileSystem;
	const text = (path: string) => {
		const value = store.get(path);
		return value ? strFromU8(value) : undefined;
	};
	return { fs, text, folders };
};

const DOWNLOADS = "/agents/Bot/sources";

describe("a zip unpacked into Files", () => {
	it("gives back the one folder it holds, beside the zip, never over one", async () => {
		const archive = zipSync({
			docs: { "index.md": strToU8("# Docs"), guide: { "a.md": strToU8("A") } },
			"docs/empty/": new Uint8Array(0),
			__MACOSX: { docs: { "._index.md": strToU8("finder") } },
		});
		const { fs, text, folders } = writableFs(
			{ [`${DOWNLOADS}/docs.zip`]: archive },
			[DOWNLOADS, `${DOWNLOADS}/docs`],
		);

		const result = await extractZip(fs, `${DOWNLOADS}/docs.zip`);

		// ~/sources/docs is taken already.
		expect(result).toEqual({
			path: `${DOWNLOADS}/docs 2`,
			fileCount: 2,
			totalBytes: 7,
		});
		expect(text(`${DOWNLOADS}/docs 2/index.md`)).toBe("# Docs");
		expect(text(`${DOWNLOADS}/docs 2/guide/a.md`)).toBe("A");
		expect(folders.has(`${DOWNLOADS}/docs 2/empty`)).toBe(true);
		expect(folders.has(`${DOWNLOADS}/__MACOSX`)).toBe(false);
	});

	it("puts loose entries in a folder named after the zip, or where it is told", async () => {
		const archive = zipSync({
			"a.txt": strToU8("a"),
			// Written on Windows: a backslash between folders.
			"nested\\b.txt": strToU8("b"),
			".DS_Store": strToU8("finder"),
		});
		const { fs, text } = writableFs({ [`${DOWNLOADS}/src.zip`]: archive }, [
			DOWNLOADS,
			"/projects",
		]);

		const result = await extractZip(fs, `${DOWNLOADS}/src.zip`, {
			into: "/projects",
		});

		expect(result.path).toBe("/projects/src");
		expect(text("/projects/src/a.txt")).toBe("a");
		expect(text("/projects/src/nested/b.txt")).toBe("b");
		expect(text("/projects/src/.DS_Store")).toBeUndefined();
	});

	it("reports its progress after each file, up to 100%", async () => {
		const archive = zipSync({
			"a.txt": strToU8("aaaa"),
			"b.txt": strToU8("bbbbbbbbbbbb"),
			"empty.txt": new Uint8Array(0),
		});
		const { fs } = writableFs({ [`${DOWNLOADS}/src.zip`]: archive }, [
			DOWNLOADS,
		]);
		const steps: ZipExtractProgress[] = [];

		await extractZip(fs, `${DOWNLOADS}/src.zip`, {
			onProgress: (progress) => steps.push(progress),
		});

		expect(steps.map(extractPercent)).toEqual([0, 25, 100, 100]);
		expect(steps.at(-1)).toEqual({
			filesDone: 3,
			fileCount: 3,
			bytesDone: 16,
			totalBytes: 16,
		});
		// A zip of empty files counts them instead.
		expect(
			extractPercent({
				filesDone: 1,
				fileCount: 4,
				bytesDone: 0,
				totalBytes: 0,
			}),
		).toBe(25);
	});

	it("gives back a lone file as itself", async () => {
		const archive = zipSync({ "report.pdf": strToU8("%PDF") });
		const { fs, text } = writableFs(
			{
				[`${DOWNLOADS}/report.zip`]: archive,
				[`${DOWNLOADS}/report.pdf`]: strToU8("older"),
			},
			[DOWNLOADS],
		);

		const result = await extractZip(fs, `${DOWNLOADS}/report.zip`);

		expect(result.path).toBe(`${DOWNLOADS}/report 2.pdf`);
		expect(text(`${DOWNLOADS}/report 2.pdf`)).toBe("%PDF");
		expect(text(`${DOWNLOADS}/report.pdf`)).toBe("older");
	});

	it("refuses an entry outside its folder, a file that is not a zip, and too much", async () => {
		const { fs } = writableFs(
			{
				[`${DOWNLOADS}/evil.zip`]: zipSync({
					"../../escape.txt": strToU8("x"),
				}),
				[`${DOWNLOADS}/notes.zip`]: strToU8("just text"),
				[`${DOWNLOADS}/big.zip`]: zipSync({ "a.bin": new Uint8Array(2_000) }),
			},
			[DOWNLOADS],
		);

		await expect(extractZip(fs, `${DOWNLOADS}/evil.zip`)).rejects.toThrow(
			"points outside its folder",
		);
		await expect(extractZip(fs, `${DOWNLOADS}/notes.zip`)).rejects.toThrow(
			"is not a zip file",
		);
		await expect(
			extractZip(fs, `${DOWNLOADS}/big.zip`, { maxBytes: 1_000 }),
		).rejects.toThrow("too much to unzip here");
	});
});
