import { describe, expect, it, vi } from "vitest";
import type { IFlowFileSystem } from "../interfaces/services/filesystem.js";
import {
	globDescendFilter,
	globSearchRoot,
	walkEntries,
} from "../tools/fs/util.js";

/**
 * Every directory in a mapped folder is a round trip to the OS, and ZenFS stats
 * each entry it lists on top of that. Walking a real project end to end took
 * over a hundred seconds and answered nothing, so what these cover is not the
 * shape of the result — it is how much of the tree was read to produce it.
 */

interface FakeTree {
	[path: string]: string[];
}

const makeFs = (tree: FakeTree) => {
	const readdir = vi.fn(async (path: string) => {
		const names = tree[path];
		if (!names) throw new Error(`ENOENT: ${path}`);
		return names.map((name) => {
			const isDir = name.endsWith("/");
			const bare = isDir ? name.slice(0, -1) : name;
			return {
				name: bare,
				isDirectory: () => isDir,
				isFile: () => !isDir,
			};
		});
	});
	const stat = vi.fn(async () => ({ size: 1, isFile: () => true }));
	return {
		fs: { readdir, stat } as unknown as IFlowFileSystem,
		readdir,
		stat,
	};
};

/** A project shaped like the one that took 103 seconds. */
const projectTree: FakeTree = {
	"/": ["grand-rts-game/", "notes/"],
	"/grand-rts-game": ["src/", "node_modules/", ".git/", "README.md"],
	"/grand-rts-game/src": ["main.ts", "engine.ts"],
	"/grand-rts-game/node_modules": ["dep-a/", "dep-b/"],
	"/grand-rts-game/node_modules/dep-a": ["index.js"],
	"/grand-rts-game/node_modules/dep-b": ["index.js"],
	"/grand-rts-game/.git": ["objects/"],
	"/grand-rts-game/.git/objects": ["aa"],
	"/notes": ["todo.md"],
};

describe("walkEntries", () => {
	it("never descends into dependency or VCS directories", async () => {
		const { fs, readdir } = makeFs(projectTree);

		const result = await walkEntries(fs, "/", { recursive: true });

		const visited = readdir.mock.calls.map(([path]) => path);
		expect(visited).not.toContain("/grand-rts-game/node_modules");
		expect(visited).not.toContain("/grand-rts-game/.git");
		expect(result.prunedDirectories).toBe(2);
		// The files that matter are still all there.
		expect(result.entries.map((e) => e.path)).toContain(
			"/grand-rts-game/src/main.ts",
		);
	});

	it("reads them when the caller opts back in", async () => {
		const { fs, readdir } = makeFs(projectTree);

		await walkEntries(fs, "/", { recursive: true, pruneNoise: false });

		expect(readdir.mock.calls.map(([path]) => path)).toContain(
			"/grand-rts-game/node_modules",
		);
	});

	it("does not stat files unless the caller wants sizes", async () => {
		const { fs, stat } = makeFs(projectTree);

		await walkEntries(fs, "/", { recursive: true });
		expect(stat).not.toHaveBeenCalled();

		await walkEntries(fs, "/", { recursive: true, withSizes: true });
		expect(stat).toHaveBeenCalled();
	});

	it("uses the size the listing already reported instead of statting", async () => {
		// The agent's filesystem resolves a path from the tree root on every
		// stat, so re-fetching a size the directory read just handed over cost a
		// full tree walk per file. A recursive listing paid that thousands of
		// times over.
		const { fs, stat } = makeFs(projectTree);
		(fs as unknown as { readdir: ReturnType<typeof vi.fn> }).readdir = vi.fn(
			async (path: string) => {
				const names = projectTree[path] ?? [];
				return names.map((name) => {
					const isDir = name.endsWith("/");
					return {
						name: isDir ? name.slice(0, -1) : name,
						isDirectory: () => isDir,
						isFile: () => !isDir,
						...(isDir ? {} : { size: 7 }),
					};
				});
			},
		);

		const result = await walkEntries(fs, "/", {
			recursive: true,
			withSizes: true,
		});

		expect(stat).not.toHaveBeenCalled();
		const file = result.entries.find((e) => e.name === "main.ts");
		expect(file?.size).toBe(7);
	});

	it("still stats when the listing does not report a size", async () => {
		const { fs, stat } = makeFs(projectTree);

		await walkEntries(fs, "/", { recursive: true, withSizes: true });

		expect(stat).toHaveBeenCalled();
	});

	it("stops at the result limit instead of reading the rest", async () => {
		const wide: FakeTree = {
			"/": Array.from({ length: 50 }, (_, i) => `d${i}/`),
		};
		for (let i = 0; i < 50; i++) wide[`/d${i}`] = ["a.txt"];
		const { fs } = makeFs(wide);

		const result = await walkEntries(fs, "/", { recursive: true, limit: 10 });

		expect(result.entries).toHaveLength(10);
		expect(result.truncated).toBe(true);
		expect(result.stopReason).toBe("limit");
	});

	it("skips an unreadable directory rather than failing the whole search", async () => {
		const { fs } = makeFs({
			"/": ["good/", "locked/"],
			"/good": ["found.txt"],
			// "/locked" is absent, so reading it throws.
		});

		const result = await walkEntries(fs, "/", { recursive: true });

		expect(result.entries.map((e) => e.path)).toContain("/good/found.txt");
	});

	it("reads siblings together rather than one after another", async () => {
		let inFlight = 0;
		let peak = 0;
		const tree: FakeTree = { "/": ["a/", "b/", "c/", "d/"] };
		for (const name of ["a", "b", "c", "d"]) tree[`/${name}`] = ["f.txt"];
		const { fs, readdir } = makeFs(tree);
		readdir.mockImplementation(async (path: string) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			const names = tree[path] ?? [];
			return names.map((name) => {
				const isDir = name.endsWith("/");
				return {
					name: isDir ? name.slice(0, -1) : name,
					isDirectory: () => isDir,
					isFile: () => !isDir,
				};
			});
		});

		await walkEntries(fs, "/", { recursive: true, concurrency: 4 });

		// Serially this peaks at 1, which is what made the walk cost one round
		// trip per directory end to end.
		expect(peak).toBeGreaterThan(1);
	});
});

describe("glob-directed pruning", () => {
	it("starts at the pattern's literal prefix", () => {
		expect(globSearchRoot("notes/2024/**/*.md", "/")).toBe("/notes/2024");
		expect(globSearchRoot("**/*.md", "/")).toBe("/");
		expect(globSearchRoot("src/**/*.ts", "/base")).toBe("/base/src");
		// A fully literal pattern names a file, not a directory to search inside.
		expect(globSearchRoot("readme.md", "/")).toBe("/");
	});

	it("prunes branches a pattern can no longer match", () => {
		const canDescend = globDescendFilter("src/**/*.ts", "/");
		expect(canDescend("/src")).toBe(true);
		expect(canDescend("/src/engine")).toBe(true);
		expect(canDescend("/docs")).toBe(false);
	});

	it("keeps every branch open for a pattern that can match anywhere", () => {
		// `**/name/**` really can match at any depth, so refusing to prune here is
		// the correct answer — the saving comes from the noise list instead.
		const canDescend = globDescendFilter("**/grand-rts-game/**", "/");
		expect(canDescend("/anything")).toBe(true);
		expect(canDescend("/a/b/c")).toBe(true);
	});

	it("only walks the matching branch for a prefixed pattern", async () => {
		const { fs, readdir } = makeFs({
			"/": ["src/", "docs/", "assets/"],
			"/src": ["main.ts"],
			"/docs": ["guide.md"],
			"/assets": ["logo.png"],
		});
		const canDescend = globDescendFilter("src/**/*.ts", "/");

		await walkEntries(fs, globSearchRoot("src/**/*.ts", "/"), {
			recursive: true,
			shouldDescend: (displayPath) => canDescend(displayPath),
		});

		const visited = readdir.mock.calls.map(([path]) => path);
		expect(visited).toContain("/src");
		expect(visited).not.toContain("/docs");
		expect(visited).not.toContain("/assets");
	});
});
