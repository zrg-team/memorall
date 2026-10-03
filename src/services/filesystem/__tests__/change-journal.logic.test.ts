import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryJournal } from "../change-journal";

/**
 * Two contexts (the Files page and the offscreen document, say) share one
 * store and one journal. A context sees another's writes only once it reloads
 * the store; the journal is how it knows it must, and what changed.
 */

type Node = { type: "dir" } | { type: "file"; data: Uint8Array };
const nodes = new Map<string, Node>();
const fsError = (code: string, path: string) =>
	Object.assign(new Error(`${code}: ${path}`), { code });

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
		async readdir() {
			return [];
		},
		async readFile(path: string) {
			const node = nodes.get(path);
			if (!node || node.type !== "file") throw fsError("ENOENT", path);
			return node.data;
		},
		async writeFile(path: string, data: Uint8Array | string) {
			nodes.set(path, {
				type: "file",
				data: typeof data === "string" ? new TextEncoder().encode(data) : data,
			});
		},
		async unlink(path: string) {
			nodes.delete(path);
		},
		async rename(from: string, to: string) {
			const node = nodes.get(from);
			if (!node) throw fsError("ENOENT", from);
			nodes.set(to, node);
			nodes.delete(from);
		},
	},
};

const refreshFsCache = vi.fn(
	async (_options?: { immediate?: boolean }) => undefined,
);

vi.mock("@/services/filesystem/fs", () => ({
	default: fakeFs,
	initializeFs: async () => undefined,
	refreshFsCache: (options?: { immediate?: boolean }) =>
		refreshFsCache(options),
	fsReady: true,
}));
vi.mock("@/platform/current", () => ({
	platform: { persistentStore: { get: async () => true, set: async () => {} } },
}));
vi.mock("@/services/filesystem/native-folders/mount-registry", () => ({
	isNativeMountRoot: () => false,
	isInsideNativeMount: () => false,
}));
vi.mock("@/services/filesystem/native-folders/watcher", () => ({
	startNativeFolderWatcher: async () => undefined,
}));

const quietBus = () => ({
	publish: vi.fn(),
	subscribe: () => () => {},
	close: () => {},
});

const load = async () => {
	const { DocumentFileSystem } = await import("../document-filesystem");
	const journal = createMemoryJournal();
	return {
		journal,
		files: DocumentFileSystem.create(quietBus(), journal),
		offscreen: DocumentFileSystem.create(quietBus(), journal),
	};
};

describe("the filesystem's change journal", () => {
	beforeEach(() => {
		nodes.clear();
		nodes.set("/home/files", { type: "dir" });
		refreshFsCache.mockClear();
	});

	it("journals every change before it is announced", async () => {
		const { files, journal } = await load();
		const heard: Array<number> = [];
		files.onFilesystemChanged(() => {
			void journal.head().then((head) => heard.push(head));
		});

		await files.writeFile("/notes/a.md", "A");
		await files.mkdir("/notes/drafts");
		await files.renamePath("/notes/a.md", "/notes/b.md");
		await vi.waitFor(() => expect(heard).toEqual([1, 2, 3]));
		const { entries, complete } = await journal.since(0);
		expect(complete).toBe(true);
		expect(entries.map((entry) => entry.change?.operation)).toEqual([
			"create",
			"mkdir",
			"rename",
		]);
	});

	it("brings a context up to another's changes, reloading only for them", async () => {
		const { files, offscreen } = await load();
		await files.writeFile("/notes/a.md", "A");

		// The offscreen document has not heard yet: catching up reloads it.
		const caught = await offscreen.catchUp(0);
		expect(caught.head).toBe(1);
		expect(caught.entries.map((entry) => entry.change?.path)).toEqual([
			"/notes/a.md",
		]);
		expect(refreshFsCache).toHaveBeenCalledWith({ immediate: true });

		// Its own changes need no reload.
		refreshFsCache.mockClear();
		await offscreen.writeFile("/notes/b.md", "B");
		await offscreen.catchUp(1);
		expect(refreshFsCache).not.toHaveBeenCalled();

		// Another context's do.
		await files.writeFile("/notes/c.md", "C");
		await offscreen.ensureFresh();
		expect(refreshFsCache).toHaveBeenCalledTimes(1);
	});

	it("announces the editor's quiet saves to everyone, marked quiet", async () => {
		const { files } = await load();
		const heard: unknown[] = [];
		files.onFilesystemChanged((change) => heard.push(change));

		await files.writeFile("/notes/a.md", "A", "quiet");
		expect(heard).toEqual([
			{ scope: "root", operation: "create", path: "/notes/a.md", quiet: true },
		]);
		// Only a caller announcing the change itself saves silently.
		await files.writeFile("/notes/a.md", "A2", false);
		expect(heard).toHaveLength(1);
	});
});
