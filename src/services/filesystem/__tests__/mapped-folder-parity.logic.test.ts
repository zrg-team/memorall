import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A mapped folder has to behave like any other folder in the library. Two places
 * where it would not, without help:
 *
 *  - renaming across a mount boundary is `EXDEV`, exactly as on a real
 *    filesystem, so dragging a file between the virtual filesystem and a mapped
 *    folder would fail where the same drag succeeds anywhere else;
 *  - deleting the mapped root is not deleting a copy, it is deleting the user's
 *    real folder.
 */

type Node = { type: "dir" } | { type: "file"; data: Uint8Array };

const nodes = new Map<string, Node>();
const fsError = (code: string, path: string) =>
	Object.assign(new Error(`${code}: ${path}`), { code });

/** Anything under this prefix pretends to be a different mount. */
const MOUNT_PREFIX = "/home/files/Notes/";
const sameDevice = (from: string, to: string) =>
	from.startsWith(MOUNT_PREFIX) === to.startsWith(MOUNT_PREFIX);

const renameCalls: Array<[string, string]> = [];
/** Every entry is a round trip to the OS for a real mapped folder. */
const readdirCalls: string[] = [];

const fakeFs = {
	promises: {
		async mkdir(path: string) {
			nodes.set(path, { type: "dir" });
		},
		async stat(path: string) {
			const node = nodes.get(path);
			if (!node) throw fsError("ENOENT", path);
			return {
				isDirectory: () => node.type === "dir",
				isFile: () => node.type === "file",
				size: node.type === "file" ? node.data.byteLength : 0,
				mtime: new Date(0),
				birthtime: new Date(0),
			};
		},
		async readdir(path: string, options?: { withFileTypes?: boolean }) {
			readdirCalls.push(path);
			const prefix = `${path}/`;
			const children = new Set<string>();
			for (const key of nodes.keys()) {
				if (!key.startsWith(prefix)) continue;
				children.add(key.slice(prefix.length).split("/")[0]);
			}
			const names = [...children];
			if (!options?.withFileTypes) return names;
			return names.map((name) => {
				const node = nodes.get(`${prefix}${name}`);
				const isDir = node?.type === "dir";
				return { name, isDirectory: () => isDir, isFile: () => !isDir };
			});
		},
		async readFile(path: string) {
			const node = nodes.get(path);
			if (!node || node.type !== "file") throw fsError("ENOENT", path);
			return node.data;
		},
		async writeFile(path: string, data: Uint8Array) {
			nodes.set(path, { type: "file", data });
		},
		async unlink(path: string) {
			if (!nodes.has(path)) throw fsError("ENOENT", path);
			nodes.delete(path);
		},
		async rmdir(path: string) {
			nodes.delete(path);
		},
		async rename(from: string, to: string) {
			renameCalls.push([from, to]);
			if (!sameDevice(from, to)) throw fsError("EXDEV", from);
			const node = nodes.get(from);
			if (!node) throw fsError("ENOENT", from);
			nodes.set(to, node);
			nodes.delete(from);
		},
	},
};

vi.mock("@/services/filesystem/fs", () => ({
	default: fakeFs,
	initializeFs: async () => undefined,
	refreshFsCache: async () => undefined,
	fsReady: true,
}));

vi.mock("@/platform/current", () => ({
	platform: { persistentStore: { get: async () => true, set: async () => {} } },
}));

// "Notes" stands in for a mapped folder; the registry itself is covered by its
// own tests.
vi.mock("@/services/filesystem/native-folders/mount-registry", () => ({
	isNativeMountRoot: (path: string) => path.replace(/\/+$/, "") === "/Notes",
	isInsideNativeMount: (path: string) =>
		path === "/Notes" || path.startsWith("/Notes/"),
}));

vi.mock("@/services/filesystem/native-folders/watcher", () => ({
	startNativeFolderWatcher: async () => undefined,
}));

vi.mock("@/services/filesystem/change-bus/current", () => ({
	createFilesystemChangeBus: () => ({
		publish: () => {},
		subscribe: () => () => {},
		close: () => {},
	}),
}));

const loadService = async () => {
	const { DocumentFileSystem } = await import("../document-filesystem");
	return DocumentFileSystem.create();
};

beforeEach(() => {
	nodes.clear();
	renameCalls.length = 0;
	readdirCalls.length = 0;
	vi.clearAllMocks();
	nodes.set("/home/files", { type: "dir" });
	nodes.set("/home/files", { type: "dir" });
	nodes.set("/home/files/Notes", { type: "dir" });
});

describe("mapped folders behave like ordinary folders", () => {
	it("falls back to copy-then-delete when a rename crosses a mount boundary", async () => {
		nodes.set("/home/files/note.md", {
			type: "file",
			data: new TextEncoder().encode("hello"),
		});
		const service = await loadService();

		await service.renamePath("/note.md", "/Notes/note.md");

		// The rename was attempted first — it is the cheap path when both sides
		// live on the same mount — and only then fell back.
		expect(renameCalls).toEqual([
			["/home/files/note.md", "/home/files/Notes/note.md"],
		]);
		expect(nodes.has("/home/files/note.md")).toBe(false);
		const moved = nodes.get("/home/files/Notes/note.md");
		expect(
			moved && moved.type === "file" && new TextDecoder().decode(moved.data),
		).toBe("hello");
	});

	it("still uses a plain rename within one mount", async () => {
		nodes.set("/home/files/Notes/a.md", {
			type: "file",
			data: new Uint8Array(),
		});
		const service = await loadService();
		await service.renamePath("/Notes/a.md", "/Notes/b.md");
		expect(nodes.has("/home/files/Notes/b.md")).toBe(true);
	});

	it("refuses to delete a mapped root, because those are the real files", async () => {
		const service = await loadService();
		await expect(service.deleteFolder("/Notes")).rejects.toThrow(/Unmap/i);
		expect(nodes.has("/home/files/Notes")).toBe(true);
	});

	it("still deletes an ordinary folder inside a mapped root", async () => {
		nodes.set("/home/files/Notes/archive", { type: "dir" });
		const service = await loadService();
		await expect(
			service.deleteFolder("/Notes/archive"),
		).resolves.toBeUndefined();
		expect(nodes.has("/home/files/Notes/archive")).toBe(false);
	});

	it("refuses to rename a mapped root", async () => {
		const service = await loadService();
		await expect(service.renamePath("/Notes", "/Renamed")).rejects.toThrow(
			/mapped folder cannot be renamed/i,
		);
	});

	it("refuses to move a mapped root", async () => {
		// A move is copy-then-delete. Without this the delete half would take the
		// user's real folder off disk after duplicating all of it into the
		// library — reachable both by dragging the folder in the sidebar and by
		// the `doc_move` tool naming it.
		nodes.set("/home/files/projects", { type: "dir" });
		const service = await loadService();

		await expect(service.move("/Notes", "/projects")).rejects.toThrow(
			/mapped folder cannot be moved/i,
		);
	});

	it("still moves an ordinary folder into a mapped folder", async () => {
		// Moving *into* a mapped folder is ordinary: it writes the user's disk,
		// which is what they asked for.
		nodes.set("/home/files/draft", { type: "dir" });
		nodes.set("/home/files/draft/a.md", {
			type: "file",
			data: new TextEncoder().encode("a"),
		});
		const service = await loadService();

		await expect(service.move("/draft", "/Notes")).resolves.toContain("/Notes");
	});

	it("leaves ordinary folders entirely alone", async () => {
		nodes.set("/home/files/projects", { type: "dir" });
		const service = await loadService();
		await expect(service.deleteFolder("/projects")).resolves.toBeUndefined();
	});
});

/**
 * Reading a mapped folder costs a round trip to the OS, so the listing is
 * cached — and the thing that decides whether mapped folders feel instant is
 * how often that cache is thrown away. Clearing it on *any* change meant the
 * agent writing one unrelated file made every open mapped folder re-read from
 * disk.
 */
describe("mapped folder listings survive unrelated changes", () => {
	const seedNotes = () => {
		nodes.set("/home/files/Notes/a.md", {
			type: "file",
			data: new TextEncoder().encode("a"),
		});
		nodes.set("/home/files/other.md", {
			type: "file",
			data: new TextEncoder().encode("o"),
		});
	};

	it("reads a folder once and serves it from cache after that", async () => {
		seedNotes();
		const service = await loadService();

		const first = await service.getFolderChildren("/Notes");
		const readsAfterFirst = readdirCalls.length;
		const second = await service.getFolderChildren("/Notes");

		expect(first.map((n) => n.name)).toEqual(["a.md"]);
		expect(second).toEqual(first);
		expect(readdirCalls.length).toBe(readsAfterFirst);
	});

	it("keeps the listing when a file elsewhere changes", async () => {
		seedNotes();
		const service = await loadService();
		await service.getFolderChildren("/Notes");
		const readsBefore = readdirCalls.length;

		service.notifyExternalChange({
			scope: "root",
			operation: "write",
			path: "/other.md",
		});
		await service.getFolderChildren("/Notes");

		expect(readdirCalls.length).toBe(readsBefore);
	});

	it("re-reads when the change is inside that folder", async () => {
		seedNotes();
		const service = await loadService();
		await service.getFolderChildren("/Notes");
		const readsBefore = readdirCalls.length;

		service.notifyExternalChange({
			scope: "root",
			operation: "write",
			path: "/Notes/b.md",
		});
		await service.getFolderChildren("/Notes");

		expect(readdirCalls.length).toBeGreaterThan(readsBefore);
	});

	it("clears everything when a change cannot be placed", async () => {
		seedNotes();
		const service = await loadService();
		await service.getFolderChildren("/Notes");
		const readsBefore = readdirCalls.length;

		// No path: a mount appearing or going away moves whole subtrees, so
		// nothing cached can be trusted.
		service.notifyExternalChange(null);
		await service.getFolderChildren("/Notes");

		expect(readdirCalls.length).toBeGreaterThan(readsBefore);
	});
});

/**
 * A recursive delete or copy inside a mapped folder is one round trip to the
 * OS per entry. Done strictly in sequence it costs depth times width; these
 * cover that the entries overlap, and that the tree still ends up right.
 */
describe("recursive operations do not run one entry at a time", () => {
	it("deletes a wide folder with overlapping calls", async () => {
		nodes.set("/home/files/wide", { type: "dir" });
		for (let i = 0; i < 24; i++) {
			nodes.set(`/home/files/wide/f${i}.md`, {
				type: "file",
				data: new TextEncoder().encode("x"),
			});
		}
		let inFlight = 0;
		let peak = 0;
		const realUnlink = fakeFs.promises.unlink;
		fakeFs.promises.unlink = async (path: string) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await Promise.resolve();
			inFlight -= 1;
			return realUnlink(path);
		};

		try {
			const service = await loadService();
			await service.deleteFolder("/wide");
		} finally {
			fakeFs.promises.unlink = realUnlink;
		}

		// Serially this peaks at 1.
		expect(peak).toBeGreaterThan(1);
		expect(nodes.has("/home/files/wide")).toBe(false);
		expect(nodes.has("/home/files/wide/f0.md")).toBe(false);
	});

	it("still copies every file when moving across a mount boundary", async () => {
		nodes.set("/home/files/src", { type: "dir" });
		for (let i = 0; i < 12; i++) {
			nodes.set(`/home/files/src/f${i}.md`, {
				type: "file",
				data: new TextEncoder().encode(`body-${i}`),
			});
		}
		const service = await loadService();

		await service.move("/src", "/Notes");

		for (let i = 0; i < 12; i++) {
			const moved = nodes.get(`/home/files/Notes/src/f${i}.md`);
			expect(moved?.type).toBe("file");
			expect(new TextDecoder().decode((moved as any).data)).toBe(`body-${i}`);
		}
		expect(nodes.has("/home/files/src")).toBe(false);
	});
});
