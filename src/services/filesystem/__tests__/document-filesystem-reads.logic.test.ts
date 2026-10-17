import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesystemChangeEnvelope } from "../change-bus/types";
import { createMemoryJournal } from "../change-journal";

/**
 * When an agent or the sandbox writes many files, every listener used to hear
 * each one separately, and every listener that re-reads the tree started its
 * own full walk of the store. A burst should cost one walk and one
 * announcement.
 */

type Node = { type: "dir" } | { type: "file"; data: Uint8Array };
const nodes = new Map<string, Node>();
const readdirCalls: string[] = [];
/** Holds the next listing open until released. */
const gate = { next: null as Promise<void> | null };
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
		async readdir(path: string) {
			readdirCalls.push(path);
			const held = gate.next;
			gate.next = null;
			// Yields, so overlapping reads really overlap.
			await (held ?? new Promise((resolve) => setTimeout(resolve, 0)));
			const prefix = `${path}/`;
			const names = new Set<string>();
			for (const key of nodes.keys()) {
				if (key.startsWith(prefix))
					names.add(key.slice(prefix.length).split("/")[0]);
			}
			return [...names].map((name) => {
				const isDir = nodes.get(`${prefix}${name}`)?.type === "dir";
				return { name, isDirectory: () => isDir, isFile: () => !isDir };
			});
		},
	},
};

const refresh = vi.hoisted(() => ({
	release: null as null | (() => void),
	pending: null as null | Promise<void>,
}));

vi.mock("@/services/filesystem/fs", () => ({
	default: fakeFs,
	initializeFs: async () => undefined,
	// One shared reload, as the real one is while its debounce is pending.
	refreshFsCache: () => {
		refresh.pending ??= new Promise<void>((resolve) => {
			refresh.release = () => {
				refresh.pending = null;
				resolve();
			};
		});
		return refresh.pending;
	},
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

const load = async () => {
	const { DocumentFileSystem } = await import("../document-filesystem");
	let deliver: (message: FilesystemChangeEnvelope) => void = () => {};
	const bus = {
		publish: vi.fn(),
		subscribe: (listener: (message: FilesystemChangeEnvelope) => void) => {
			deliver = listener;
			return () => {};
		},
		close: () => {},
	};
	const files = DocumentFileSystem.create(bus, createMemoryJournal());
	await files.initialize();
	return {
		files,
		deliver: (message: FilesystemChangeEnvelope) => deliver(message),
	};
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	nodes.clear();
	readdirCalls.length = 0;
	gate.next = null;
	refresh.release = null;
	refresh.pending = null;
	nodes.set("/home/files/notes.md", {
		type: "file",
		data: new Uint8Array([1]),
	});
});

describe("reading the library tree", () => {
	it("shares one walk between callers asking while it runs", async () => {
		const { files } = await load();
		readdirCalls.length = 0;

		const reads = await Promise.all([
			files.getTree("/"),
			files.getTree("/"),
			files.getTree("/"),
		]);

		expect(readdirCalls).toEqual(["/home/files"]);
		expect(reads[1]).toBe(reads[0]);
		expect(reads[2]).toBe(reads[0]);
	});

	it("starts a new walk after a change, and an older walk does not fill the cache", async () => {
		const { files } = await load();
		readdirCalls.length = 0;
		let release!: () => void;
		gate.next = new Promise<void>((resolve) => {
			release = resolve;
		});

		const before = files.getTree("/");
		while (readdirCalls.length === 0) await flush();
		files.forceRefresh();
		const after = await files.getTree("/");
		// The older walk finishes last; the cache must still hold the newer one.
		release();
		const stale = await before;

		expect(stale).not.toBe(after);
		expect(await files.getTree("/")).toBe(after);
		expect(readdirCalls).toHaveLength(2);
	});
});

describe("folder listings after a change in this context", () => {
	it("are read again all the way up, so a new folder's files are found", async () => {
		const { files } = await load();
		const names = async (path: string) =>
			(await files.getFolderChildren(path)).map((node) => node.name).sort();
		expect(await names("/")).toEqual(["notes.md"]);

		// An agent writes into folders that did not exist; only the file is
		// announced, as a write that creates its folders on the way does.
		nodes.set("/home/files/content", { type: "dir" });
		nodes.set("/home/files/content/ttv", { type: "dir" });
		nodes.set("/home/files/content/ttv/script.md", {
			type: "file",
			data: new Uint8Array([1]),
		});
		await (
			files as unknown as {
				notifyFilesystemChanged(change: unknown): Promise<void>;
			}
		).notifyFilesystemChanged({
			scope: "root",
			operation: "write",
			path: "/content/ttv/script.md",
		});

		expect(await names("/")).toEqual(["content", "notes.md"]);
		expect(await names("/content")).toEqual(["ttv"]);
		expect(await names("/content/ttv")).toEqual(["script.md"]);
	});

	it("are not kept when a change came in while they were read", async () => {
		const { files } = await load();
		// A slow listing: taken before the change, handed back after it.
		const list = fakeFs.promises.readdir;
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let listed = false;
		fakeFs.promises.readdir = async (path: string) => {
			const entries = await list(path);
			listed = true;
			await held;
			return entries;
		};
		try {
			const reading = files.getFolderChildren("/");
			while (!listed) await flush();
			nodes.set("/home/files/new.md", {
				type: "file",
				data: new Uint8Array([1]),
			});
			files.forceRefresh();
			release();
			expect((await reading).map((node) => node.name)).not.toContain("new.md");
		} finally {
			fakeFs.promises.readdir = list;
		}

		const names = (await files.getFolderChildren("/")).map((node) => node.name);
		expect(names).toContain("new.md");
	});
});

describe("changes made by other contexts", () => {
	it("are announced once per burst, after the reload that makes them visible", async () => {
		const { files, deliver } = await load();
		const listener = vi.fn();
		files.onFilesystemChanged(listener);

		for (const [index, path] of ["/a.md", "/b.md", "/c.md"].entries()) {
			deliver({
				sourceContextId: "offscreen",
				eventId: `event-${index}`,
				change: { scope: "root", operation: "write", path, origin: "sandbox" },
			});
		}
		await flush();
		expect(listener).not.toHaveBeenCalled();

		refresh.release?.();
		await flush();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			scope: "root",
			operation: "batch",
			origin: "sandbox",
			changes: [
				expect.objectContaining({ path: "/a.md" }),
				expect.objectContaining({ path: "/b.md" }),
				expect.objectContaining({ path: "/c.md" }),
			],
		});
	});

	it("hand a single change over as it came, and an unknown one alongside the known", async () => {
		const { files, deliver } = await load();
		const listener = vi.fn();
		files.onFilesystemChanged(listener);
		const change = {
			scope: "root" as const,
			operation: "write" as const,
			path: "/a.md",
			quiet: true,
		};

		deliver({ sourceContextId: "offscreen", eventId: "one", change });
		await flush();
		refresh.release?.();
		await flush();
		expect(listener).toHaveBeenLastCalledWith(change);

		deliver({ sourceContextId: "offscreen", eventId: "two", change });
		deliver({ sourceContextId: "offscreen", eventId: "three", change: null });
		await flush();
		refresh.release?.();
		await flush();
		// The known change still goes out: listeners that act on paths would
		// otherwise lose it to the unknown one.
		expect(listener).toHaveBeenCalledTimes(3);
		expect(listener).toHaveBeenNthCalledWith(2, change);
		expect(listener).toHaveBeenLastCalledWith(null);
	});

	it("are announced about once a second while changes keep coming", async () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		try {
			const { files, deliver } = await load();
			const listener = vi.fn();
			files.onFilesystemChanged(listener);
			const write = (path: string, eventId: string) =>
				deliver({
					sourceContextId: "offscreen",
					eventId,
					change: { scope: "root", operation: "write", path },
				});

			write("/a.md", "a");
			await flush();
			// a is visible, but b came before it was announced: same burst.
			refresh.release?.();
			write("/b.md", "b");
			await flush();
			expect(listener).not.toHaveBeenCalled();

			// Still coming more than a second later: what is visible goes out.
			now.mockReturnValue(2_500);
			refresh.release?.();
			write("/c.md", "c");
			await flush();
			expect(listener).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenLastCalledWith(
				expect.objectContaining({
					operation: "batch",
					changes: [
						expect.objectContaining({ path: "/a.md" }),
						expect.objectContaining({ path: "/b.md" }),
					],
				}),
			);

			refresh.release?.();
			await flush();
			expect(listener).toHaveBeenLastCalledWith(
				expect.objectContaining({ path: "/c.md" }),
			);
		} finally {
			now.mockRestore();
		}
	});
});
