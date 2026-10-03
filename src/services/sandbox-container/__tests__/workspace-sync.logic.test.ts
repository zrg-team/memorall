import * as almostnode from "almostnode";
import { VirtualFS } from "almostnode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	handleSyncOperation,
	installSyncCapture,
	resetSyncState,
} from "../../../../public/sandbox/core/sandbox-sync.js";
import type {
	FilesystemBatchOp,
	FilesystemChangeEvent,
	FilesystemSyncEntry,
} from "@/services/filesystem/document-filesystem";
import {
	createMemoryLocalTreeStore,
	LocalTreeCache,
	sha256,
} from "../local-tree-cache";
import {
	DEFAULT_WORKSPACE_SYNC_LIMITS,
	SANDBOX_SYNC_ORIGIN,
	WorkspaceSync,
	type WorkspaceSyncFiles,
	type WorkspaceSyncRuntime,
} from "../workspace-sync";

/** AlmostNode's Node `fs`, which its typings leave out. */
const createFsShim = (
	almostnode as unknown as { createFsShim: (vfs: VirtualFS) => unknown }
).createFsShim;
/** The runtime's sync operations, typed for the test. */
const syncOp = handleSyncOperation as (
	operation: string,
	payload: unknown,
	vfs: VirtualFS,
) => any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const isWithin = (path: string, root: string) =>
	root === "/" || path === root || path.startsWith(`${root}/`);

/** The documents filesystem: files with modification times, and folders. */
const createHost = () => {
	const files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>();
	const dirs = new Set<string>();
	const listeners = new Set<(change: FilesystemChangeEvent | null) => void>();
	/** The filesystem's journal: every change, by any context, in order. */
	const journal: Array<{
		seq: number;
		contextId: string;
		at: number;
		change: FilesystemChangeEvent | null;
	}> = [];
	const record = (change: FilesystemChangeEvent | null) =>
		journal.push({ seq: journal.length + 1, contextId: "host", at: 0, change });
	let clock = 1_000;
	const addParents = (path: string) => {
		for (let dir = path.slice(0, path.lastIndexOf("/")); dir; ) {
			dirs.add(dir);
			dir = dir.slice(0, dir.lastIndexOf("/"));
		}
	};
	const emit = (change: FilesystemChangeEvent | null) => {
		record(change);
		for (const listener of listeners) listener(change);
	};
	const write = (path: string, content: string | Uint8Array, notify = true) => {
		files.set(path, {
			bytes: typeof content === "string" ? encoder.encode(content) : content,
			mtimeMs: ++clock,
		});
		addParents(path);
		if (notify) emit({ scope: "root", operation: "write", path });
	};
	/** Another context saved it, and its message has not arrived yet. */
	const writeElsewhere = (path: string, content: string) => {
		write(path, content, false);
		record({ scope: "root", operation: "write", path });
	};
	const remove = (root: string) => {
		for (const path of Array.from(files.keys())) {
			if (isWithin(path, root)) files.delete(path);
		}
		for (const dir of Array.from(dirs))
			if (isWithin(dir, root)) dirs.delete(dir);
	};
	const port: WorkspaceSyncFiles = {
		list: vi.fn(async (root: string) => {
			const entries: FilesystemSyncEntry[] = [];
			for (const dir of dirs) {
				if (dir !== root && isWithin(dir, root)) {
					entries.push({ path: dir, type: "dir", size: 0, mtimeMs: 0 });
				}
			}
			for (const [path, file] of files) {
				if (isWithin(path, root)) {
					entries.push({
						path,
						type: "file",
						size: file.bytes.byteLength,
						mtimeMs: file.mtimeMs,
					});
				}
			}
			return entries;
		}),
		stat: vi.fn(async (path: string) => {
			const file = files.get(path);
			if (file) {
				return {
					path,
					type: "file" as const,
					size: file.bytes.byteLength,
					mtimeMs: file.mtimeMs,
				};
			}
			return dirs.has(path)
				? { path, type: "dir" as const, size: 0, mtimeMs: 0 }
				: null;
		}),
		read: vi.fn(async (path: string) => {
			const file = files.get(path);
			if (!file) throw new Error(`File not found: ${path}`);
			return file.bytes;
		}),
		apply: vi.fn(
			async (
				ops: readonly FilesystemBatchOp[],
				buffer: ArrayBuffer | undefined,
				origin: string,
			) => {
				const bytes = new Uint8Array(buffer ?? new ArrayBuffer(0));
				for (const op of ops) {
					if (op.op === "write") {
						write(
							op.path,
							bytes.slice(op.offset, op.offset + op.length),
							false,
						);
					} else if (op.op === "mkdir") {
						dirs.add(op.path);
						addParents(op.path);
					} else if (op.op === "delete") {
						remove(op.path);
					} else {
						remove(op.to);
						for (const [path, file] of Array.from(files)) {
							if (!isWithin(path, op.from)) continue;
							files.delete(path);
							files.set(`${op.to}${path.slice(op.from.length)}`, file);
						}
						for (const dir of Array.from(dirs)) {
							if (!isWithin(dir, op.from)) continue;
							dirs.delete(dir);
							dirs.add(`${op.to}${dir.slice(op.from.length)}`);
						}
						addParents(op.to);
					}
				}
				emit({ scope: "root", operation: "batch", origin, changes: [] });
				return [];
			},
		),
		catchUp: vi.fn(async (afterSeq: number) => ({
			head: journal.length,
			entries: journal.filter((entry) => entry.seq > afterSeq),
			complete: true,
		})),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return { files, dirs, port, write, writeElsewhere, remove, emit };
};

/** The sandbox: AlmostNode's VFS with the runtime's sync, as the iframe runs it. */
const createSandbox = () => {
	let vfs = new VirtualFS();
	installSyncCapture(vfs);
	const runtime: WorkspaceSyncRuntime = {
		state: vi.fn(async () => syncOp("sync.state", undefined, vfs)),
		apply: vi.fn(async (batch) => syncOp("sync.apply", batch, vfs)),
		collect: vi.fn(async (options) => syncOp("sync.collect", options, vfs)),
		ack: vi.fn(async (batchId, failures) => {
			syncOp("sync.ack", { batchId, failures }, vfs);
		}),
		packLocal: vi.fn(async (root) => syncOp("sync.packLocal", { root }, vfs)),
		restoreLocal: vi.fn(async (pack) => syncOp("sync.restoreLocal", pack, vfs)),
	};
	const fs = () =>
		createFsShim(vfs) as unknown as {
			writeFileSync(path: string, data: string): void;
			readFileSync(path: string, encoding: "utf8"): string;
			existsSync(path: string): boolean;
			mkdirSync(path: string, options?: { recursive?: boolean }): void;
			rmSync(path: string, options?: { recursive?: boolean }): void;
			renameSync(from: string, to: string): void;
			readdirSync(path: string): string[];
		};
	return {
		runtime,
		fs,
		get vfs() {
			return vfs;
		},
		/** A runtime reset: a new, empty VFS. */
		reset() {
			resetSyncState();
			vfs = new VirtualFS();
			installSyncCapture(vfs);
		},
	};
};

const read = (sandbox: ReturnType<typeof createSandbox>, path: string) =>
	sandbox.fs().readFileSync(path, "utf8");

describe("WorkspaceSync", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", { parent: { postMessage: vi.fn() } });
		resetSyncState();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("fills a new VFS once: content within budget, the rest as stubs", async () => {
		const host = createHost();
		host.write("/agents/bot/Bot.md", "# Bot", false);
		host.write("/agents/bot/site/index.html", "<h1>hi</h1>", false);
		host.write("/agents/bot/site/node_modules/x/index.js", "dep", false);
		host.write("/agents/bot/.git/HEAD", "ref", false);
		host.write("/big/data.bin", "x".repeat(64), false);
		host.dirs.add("/empty");
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime, {
			...DEFAULT_WORKSPACE_SYNC_LIMITS,
			maxFileBytes: 32,
		});
		sync.start();

		await sync.ready();
		const fs = sandbox.fs();
		expect(read(sandbox, "/agents/bot/site/index.html")).toBe("<h1>hi</h1>");
		expect(fs.existsSync("/empty")).toBe(true);
		// Dependencies and git's store stay where they belong.
		expect(fs.existsSync("/agents/bot/site/node_modules")).toBe(false);
		expect(fs.existsSync("/agents/bot/.git")).toBe(false);
		// Too large to copy up front: listed, content on demand.
		expect(fs.readdirSync("/big")).toEqual(["data.bin"]);
		expect(() => read(sandbox, "/big/data.bin")).toThrow(
			"Workspace file not materialized: /big/data.bin",
		);
		await sync.ready(["/big"]);
		expect(read(sandbox, "/big/data.bin")).toBe("x".repeat(64));

		// Filled once: the next command only checks.
		await sync.ready();
		expect(host.port.list).toHaveBeenCalledTimes(1);
	});

	it("sends what changes on the host, and nothing the sandbox saved itself", async () => {
		const host = createHost();
		host.write("/notes/a.md", "A", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();

		host.write("/notes/a.md", "A2");
		host.write("/notes/b.md", "B");
		await vi.advanceTimersByTimeAsync(60);
		expect(read(sandbox, "/notes/a.md")).toBe("A2");
		expect(read(sandbox, "/notes/b.md")).toBe("B");

		// The sandbox's own save comes back as a change from its origin.
		sandbox.fs().writeFileSync("/notes/c.md", "C");
		await sync.flush();
		expect(new TextDecoder().decode(host.files.get("/notes/c.md")?.bytes)).toBe(
			"C",
		);
		const reads = vi.mocked(host.port.read).mock.calls.length;
		await vi.advanceTimersByTimeAsync(60);
		expect(vi.mocked(host.port.read).mock.calls.length).toBe(reads);
		expect(sync.syncedEntry("/notes/c.md")).toMatchObject({
			type: "file",
			size: 1,
		});

		// A move on the host moves in the sandbox; no content is read for it.
		host.files.set("/notes/moved.md", host.files.get("/notes/b.md")!);
		host.files.delete("/notes/b.md");
		host.emit({
			scope: "root",
			operation: "rename",
			oldPath: "/notes/b.md",
			newPath: "/notes/moved.md",
		});
		await vi.advanceTimersByTimeAsync(60);
		expect(read(sandbox, "/notes/moved.md")).toBe("B");
		expect(sandbox.fs().existsSync("/notes/b.md")).toBe(false);
		expect(vi.mocked(host.port.read).mock.calls.length).toBe(reads);
	});

	it("compares the whole tree after a change nobody can describe", async () => {
		const host = createHost();
		host.write("/repo/a.txt", "a", false);
		host.write("/repo/b.txt", "b", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();
		vi.mocked(host.port.read).mockClear();

		// A git checkout: files change behind the change events.
		host.write("/repo/a.txt", "a2", false);
		host.remove("/repo/b.txt");
		host.write("/repo/c.txt", "c", false);
		host.emit(null);
		await vi.advanceTimersByTimeAsync(60);

		expect(read(sandbox, "/repo/a.txt")).toBe("a2");
		expect(read(sandbox, "/repo/c.txt")).toBe("c");
		expect(sandbox.fs().existsSync("/repo/b.txt")).toBe(false);
		// Only what changed was read.
		expect(
			vi
				.mocked(host.port.read)
				.mock.calls.map(([path]) => path)
				.sort(),
		).toEqual(["/repo/a.txt", "/repo/c.txt"]);
	});

	it("keeps the change saved last when both sides change a file", async () => {
		const host = createHost();
		host.write("/doc.md", "start", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();

		// The user edits it while a command rewrites it; the command's change
		// reaches the host after the user's.
		sandbox.fs().writeFileSync("/doc.md", "from the sandbox");
		host.write("/doc.md", "from the user");
		await vi.advanceTimersByTimeAsync(60);
		expect(read(sandbox, "/doc.md")).toBe("from the sandbox");
		await sync.flush();
		expect(decoder.decode(host.files.get("/doc.md")?.bytes)).toBe(
			"from the sandbox",
		);

		// Saved: the user's next edit goes to the sandbox.
		host.write("/doc.md", "edited again");
		await vi.advanceTimersByTimeAsync(60);
		expect(read(sandbox, "/doc.md")).toBe("edited again");
	});

	it("saves a removed folder, a move and dependencies as the sandbox left them", async () => {
		const host = createHost();
		host.write("/app/src/a.js", "a", false);
		host.write("/app/src/b.js", "b", false);
		host.write("/app/old/x.js", "x", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();

		const fs = sandbox.fs();
		fs.rmSync("/app/old", { recursive: true });
		fs.renameSync("/app/src", "/app/lib");
		fs.mkdirSync("/app/node_modules/dep", { recursive: true });
		fs.writeFileSync("/app/node_modules/dep/index.js", "dependency");
		await sync.flush();

		expect(Array.from(host.files.keys()).sort()).toEqual([
			"/app/lib/a.js",
			"/app/lib/b.js",
		]);
		const [ops] = vi.mocked(host.port.apply).mock.calls.at(-1) ?? [];
		expect(ops).toEqual([
			{ op: "rename", from: "/app/src", to: "/app/lib" },
			{ op: "delete", path: "/app/old", dir: true },
		]);
		expect(vi.mocked(host.port.apply).mock.calls.at(-1)?.[2]).toBe(
			SANDBOX_SYNC_ORIGIN,
		);
	});

	it("fills a VFS that replaced the old one", async () => {
		const host = createHost();
		host.write("/a.txt", "a", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();
		expect(read(sandbox, "/a.txt")).toBe("a");

		sandbox.reset();
		expect(sandbox.fs().existsSync("/a.txt")).toBe(false);
		await sync.ready();
		expect(read(sandbox, "/a.txt")).toBe("a");
	});

	it("has another context's change before it runs, announced or not", async () => {
		const host = createHost();
		host.write("/notes/a.md", "A", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();

		// Saved in the Files page a moment ago; its message is still on the way.
		host.writeElsewhere("/notes/a.md", "edited in Files");
		host.writeElsewhere("/notes/new.md", "new");
		await sync.ready();
		expect(read(sandbox, "/notes/a.md")).toBe("edited in Files");
		expect(read(sandbox, "/notes/new.md")).toBe("new");
	});

	it("keeps ignored caches and dependencies in the sandbox, and build output synced", async () => {
		const host = createHost();
		host.write("/app/.gitignore", "node_modules/\n.next\ndist/\n.env\n", false);
		host.write("/app/.next/old.js", "stale build cache", false);
		host.write("/app/src/page.js", "page", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime);
		sync.start();
		await sync.ready();
		const fs = sandbox.fs();
		expect(fs.existsSync("/app/.next")).toBe(false);
		expect(read(sandbox, "/app/src/page.js")).toBe("page");

		fs.mkdirSync("/app/.next/cache", { recursive: true });
		fs.writeFileSync("/app/.next/cache/x.json", "{}");
		fs.mkdirSync("/app/dist", { recursive: true });
		fs.writeFileSync("/app/dist/index.html", "<p>built</p>");
		fs.writeFileSync("/app/.env", "TOKEN=1");
		await sync.flush();

		expect(host.files.has("/app/.next/cache/x.json")).toBe(false);
		// What the user ships or edits still reaches the Files page.
		expect(decoder.decode(host.files.get("/app/dist/index.html")?.bytes)).toBe(
			"<p>built</p>",
		);
		expect(decoder.decode(host.files.get("/app/.env")?.bytes)).toBe("TOKEN=1");
	});

	it("caches node_modules by its lockfile and puts it back after a reset", async () => {
		const host = createHost();
		host.write("/app/package.json", '{"dependencies":{"lodash":"4"}}', false);
		host.write("/app/package-lock.json", '{"lockfileVersion":3}', false);
		const sandbox = createSandbox();
		const cache = new LocalTreeCache(createMemoryLocalTreeStore());
		const sync = new WorkspaceSync(
			host.port,
			sandbox.runtime,
			DEFAULT_WORKSPACE_SYNC_LIMITS,
			cache,
		);
		sync.start();
		await sync.ready(["/app"]);

		// `npm install`, in the sandbox only.
		const fs = sandbox.fs();
		fs.mkdirSync("/app/node_modules/lodash", { recursive: true });
		fs.writeFileSync(
			"/app/node_modules/lodash/index.js",
			"module.exports = 4;",
		);
		await sync.flush();
		expect(host.files.has("/app/node_modules/lodash/index.js")).toBe(false);
		// Cached once the sandbox is quiet; the save runs on the sync's chain.
		await vi.advanceTimersByTimeAsync(1_600);
		await sync.saveLocalTrees();
		const lockHash = await sha256(encoder.encode('{"lockfileVersion":3}'));
		expect(
			await cache.has("/app/node_modules", `package-lock.json:${lockHash}`),
		).toBe(true);

		// A reset: the next command in the project finds its packages.
		sandbox.reset();
		await sync.ready(["/app/src"]);
		expect(read(sandbox, "/app/node_modules/lodash/index.js")).toBe(
			"module.exports = 4;",
		);

		// A new lockfile: the cached tree is out of date, so it stays out.
		host.write("/app/package-lock.json", '{"lockfileVersion":3,"new":true}');
		sandbox.reset();
		await sync.ready(["/app"]);
		expect(sandbox.fs().existsSync("/app/node_modules")).toBe(false);
	});

	it("caches a tree before a reset drops it", async () => {
		const host = createHost();
		host.write("/app/package.json", '{"dependencies":{}}', false);
		const sandbox = createSandbox();
		const cache = new LocalTreeCache(createMemoryLocalTreeStore());
		const sync = new WorkspaceSync(
			host.port,
			sandbox.runtime,
			DEFAULT_WORKSPACE_SYNC_LIMITS,
			cache,
		);
		sync.start();
		await sync.ready(["/app"]);
		sandbox.fs().mkdirSync("/app/node_modules/a", { recursive: true });
		sandbox.fs().writeFileSync("/app/node_modules/a/index.js", "a");
		await sync.flush();
		// No waiting for the quiet period: the reset saves it first.
		await sync.saveLocalTrees();
		expect(await cache.roots()).toEqual(["/app/node_modules"]);
	});

	it("sends a file the sandbox read before having it", async () => {
		const host = createHost();
		host.write("/video/clip.bin", "0123456789", false);
		const sandbox = createSandbox();
		const sync = new WorkspaceSync(host.port, sandbox.runtime, {
			...DEFAULT_WORKSPACE_SYNC_LIMITS,
			maxFileBytes: 4,
		});
		sync.start();
		await sync.ready();
		expect(() => read(sandbox, "/video/clip.bin")).toThrow("not materialized");

		await expect(sync.materialize(["/video/clip.bin"])).resolves.toBe(true);
		expect(read(sandbox, "/video/clip.bin")).toBe("0123456789");
		await expect(sync.materialize(["/video/missing.bin"])).resolves.toBe(false);
	});
});
