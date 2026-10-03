import * as almostnode from "almostnode";
import { VirtualFS } from "almostnode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFsOperation } from "../../../../public/sandbox/core/sandbox-fs-handlers.js";
import {
	WORKSPACE_OPS_PENDING_CHANNEL,
	isSyncedPath,
} from "../../../../public/sandbox/core/sandbox-vfs.js";
import {
	ackSyncBatch,
	applyHostBatch,
	collectSyncBatch,
	getSyncState,
	handleSyncOperation,
	installSyncCapture,
	resetSyncState,
} from "../../../../public/sandbox/core/sandbox-sync.js";
import {
	rememberInstalledPackages,
	runtimeState,
} from "../../../../public/sandbox/runtime/shared.js";
import { createPathPolicy as createHostPathPolicy } from "../path-policy";
import { createPathPolicy as createRuntimePathPolicy } from "../../../../public/sandbox/core/path-policy.js";

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

type Op = Record<string, unknown> & { op: string };

/** A host batch: contents packed into one buffer, as the host sends them. */
const hostBatch = (
	entries: Array<
		| { op: "write"; path: string; content: string | Uint8Array }
		| { op: "stub"; path: string; size: number }
		| { op: "mkdir" | "delete"; path: string }
		| { op: "rename"; from: string; to: string }
	>,
) => {
	const parts: Uint8Array[] = [];
	let offset = 0;
	const ops = entries.map((entry) => {
		if (entry.op !== "write") return entry;
		const bytes =
			typeof entry.content === "string"
				? encoder.encode(entry.content)
				: entry.content;
		parts.push(bytes);
		const op = { op: "write", path: entry.path, offset, length: bytes.length };
		offset += bytes.length;
		return op;
	});
	const buffer = new ArrayBuffer(offset);
	let at = 0;
	for (const part of parts) {
		new Uint8Array(buffer).set(part, at);
		at += part.length;
	}
	return { vfsId: getSyncState().vfsId, ops, buffer };
};

/** What a collected batch says, with contents as text. */
const describeBatch = (batch: { ops: Op[]; buffer?: ArrayBuffer }) =>
	batch.ops.map((op) =>
		op.op === "write"
			? {
					op: "write",
					path: op.path,
					content: decoder.decode(
						new Uint8Array(
							batch.buffer as ArrayBuffer,
							op.offset as number,
							op.length as number,
						),
					),
				}
			: op,
	);

const createSandbox = () => {
	const vfs = new VirtualFS();
	installSyncCapture(vfs);
	const fs = createFsShim(vfs) as unknown as {
		writeFileSync(path: string, data: string | Uint8Array): void;
		readFileSync(path: string, encoding?: string): string | Uint8Array;
		mkdirSync(path: string, options?: { recursive?: boolean }): void;
		rmSync(
			path: string,
			options?: { recursive?: boolean; force?: boolean },
		): void;
		renameSync(from: string, to: string): void;
		copyFileSync(from: string, to: string): void;
		statSync(path: string): { size: number; isFile(): boolean };
		readdirSync(path: string): string[];
		existsSync(path: string): boolean;
		unlinkSync(path: string): void;
	};
	return { vfs, fs };
};

/** Sends everything the sandbox has to the host and acknowledges it. */
const saveAll = (vfs: VirtualFS) => {
	const batch = collectSyncBatch(vfs);
	if (batch.batchId !== null) ackSyncBatch(batch.batchId, []);
	return batch;
};

describe("sandbox sync: which paths cross", () => {
	const gitignores: Record<string, string> = {
		"/": "*.log\n",
		"/app": [
			"# build caches",
			"node_modules/",
			".next",
			"/coverage/",
			"dist/",
			".env",
			"**/__pycache__",
			"!.cache",
		].join("\n"),
		"/app/packages/ui": ".turbo/\n",
	};
	const policies = {
		runtime: createRuntimePathPolicy((dir: string) => gitignores[dir] ?? null),
		host: createHostPathPolicy((dir) => gitignores[dir] ?? null),
	};
	const cases: Array<[string, boolean, string | null]> = [
		// Synced: sources, build output and ignored files.
		["/agents/bot/site/index.html", true, null],
		["/app/dist/index.html", true, null],
		["/app/.env", true, null],
		["/app/server.log", true, null],
		["/app/src/coverage/report.html", true, null],
		// A cache folder no .gitignore names, or one re-included.
		["/other/.next/cache.json", true, null],
		["/app/.cache/x", true, null],
		// Git's store: the host's.
		["/app/.git/HEAD", false, null],
		// Dependencies, at any depth: local.
		["/node_modules/lodash/lodash.js", false, "/node_modules"],
		["/app/node_modules/react/index.js", false, "/app/node_modules"],
		// Ignored caches: local.
		["/app/.next/server/page.js", false, "/app/.next"],
		["/app/coverage/lcov.info", false, "/app/coverage"],
		["/app/lib/__pycache__/a.pyc", false, "/app/lib/__pycache__"],
		["/app/packages/ui/.turbo/log", false, "/app/packages/ui/.turbo"],
	];

	it.each(cases)("%s: synced %s", (path, synced, root) => {
		for (const policy of Object.values(policies)) {
			expect(policy.isSynced(path)).toBe(synced);
			expect(policy.localRootOf(path)).toBe(root);
		}
	});

	it("never syncs the root itself", () => {
		expect(policies.runtime.isSynced("/")).toBe(false);
		expect(policies.host.isSynced("/")).toBe(false);
	});
});

describe("sandbox sync: local trees", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", { parent: { postMessage: vi.fn() } });
		resetSyncState();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("tells the host which local trees changed, and never sends their files", () => {
		const { vfs, fs } = createSandbox();
		fs.mkdirSync("/app", { recursive: true });
		fs.writeFileSync("/app/.gitignore", ".next\n");
		fs.mkdirSync("/app/.next/cache", { recursive: true });
		fs.writeFileSync("/app/.next/cache/a.json", "{}");
		fs.mkdirSync("/app/node_modules/x", { recursive: true });
		fs.writeFileSync("/app/node_modules/x/index.js", "x");

		const batch = collectSyncBatch(vfs);
		expect(batch.localDirty?.sort()).toEqual([
			"/app/.next",
			"/app/node_modules",
		]);
		expect(batch.ops.map((op: Op) => op.path ?? op.to).sort()).toEqual([
			"/app",
			"/app/.gitignore",
		]);
	});

	it("packs a tree and puts it back into a VFS that lacks it", () => {
		const { vfs, fs } = createSandbox();
		fs.mkdirSync("/app/node_modules/x/lib", { recursive: true });
		fs.writeFileSync("/app/node_modules/x/lib/index.js", "module.exports = 1;");
		fs.writeFileSync(
			"/app/node_modules/x/logo.png",
			new Uint8Array([0x89, 0x50]),
		);
		const pack = syncOp("sync.packLocal", { root: "/app/node_modules" }, vfs);
		expect(pack).toMatchObject({ root: "/app/node_modules", exists: true });

		resetSyncState();
		const next = createSandbox();
		expect(syncOp("sync.restoreLocal", pack, next.vfs)).toMatchObject({
			restored: true,
			files: 2,
		});
		expect(
			next.fs.readFileSync("/app/node_modules/x/lib/index.js", "utf8"),
		).toBe("module.exports = 1;");
		expect(next.fs.readFileSync("/app/node_modules/x/logo.png")).toEqual(
			new Uint8Array([0x89, 0x50]),
		);
		// Put back, not made: nothing for the host to save or cache.
		expect(collectSyncBatch(next.vfs)).toMatchObject({
			ops: [],
			localDirty: [],
		});
		// A folder the sandbox made itself wins over the cache.
		expect(syncOp("sync.restoreLocal", pack, next.vfs)).toMatchObject({
			restored: false,
		});
		expect(
			syncOp("sync.packLocal", { root: "/gone/node_modules" }, vfs),
		).toEqual({
			root: "/gone/node_modules",
			exists: false,
		});
	});
});

describe("sandbox sync: sandbox → host", () => {
	const postMessage = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers();
		postMessage.mockClear();
		vi.stubGlobal("window", { parent: { postMessage } });
		resetSyncState();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("sends the fewest changes that bring the host to what the sandbox has", async () => {
		const { vfs, fs } = createSandbox();
		fs.mkdirSync("/site/css", { recursive: true });
		fs.writeFileSync("/site/index.html", "<h1>v1</h1>");
		fs.writeFileSync("/site/index.html", "<h1>v2</h1>");
		fs.writeFileSync("/site/css/main.css", "h1{}");
		fs.copyFileSync("/site/css/main.css", "/site/css/copy.css");
		fs.mkdirSync("/site/node_modules/x", { recursive: true });
		fs.writeFileSync("/site/node_modules/x/index.js", "dependency");

		// The host is told once that changes wait.
		await vi.advanceTimersByTimeAsync(150);
		expect(postMessage).toHaveBeenCalledTimes(1);
		expect(postMessage).toHaveBeenCalledWith(
			{ channel: WORKSPACE_OPS_PENDING_CHANNEL },
			"*",
		);

		const batch = collectSyncBatch(vfs);
		expect(describeBatch(batch)).toEqual([
			{ op: "mkdir", path: "/site/css" },
			{ op: "write", path: "/site/index.html", content: "<h1>v2</h1>" },
			{ op: "write", path: "/site/css/copy.css", content: "h1{}" },
			{ op: "write", path: "/site/css/main.css", content: "h1{}" },
		]);
		ackSyncBatch(batch.batchId, []);
		expect(collectSyncBatch(vfs).ops).toEqual([]);
	});

	it("deletes a removed folder once, and a file and folder alike", () => {
		const { vfs, fs } = createSandbox();
		fs.mkdirSync("/app/src/lib", { recursive: true });
		fs.writeFileSync("/app/src/a.js", "a");
		fs.writeFileSync("/app/src/lib/b.js", "b");
		fs.writeFileSync("/app/keep.txt", "k");
		saveAll(vfs);

		// rm -rf: every file unlinked, every folder removed.
		fs.rmSync("/app/src", { recursive: true, force: true });
		fs.unlinkSync("/app/keep.txt");
		expect(collectSyncBatch(vfs).ops).toEqual([
			{ op: "delete", path: "/app/keep.txt", dir: false },
			{ op: "delete", path: "/app/src", dir: true },
		]);
	});

	it("moves what the host has as a move, and sends only what changed in it", () => {
		const { vfs, fs } = createSandbox();
		fs.mkdirSync("/docs", { recursive: true });
		fs.writeFileSync("/docs/a.md", "A");
		fs.writeFileSync("/docs/b.md", "B");
		saveAll(vfs);

		fs.writeFileSync("/docs/b.md", "B2");
		fs.renameSync("/docs", "/notes");
		fs.writeFileSync("/draft.md", "new");
		fs.renameSync("/draft.md", "/notes/draft.md");

		expect(describeBatch(collectSyncBatch(vfs))).toEqual([
			{ op: "rename", from: "/docs", to: "/notes" },
			{ op: "write", path: "/notes/b.md", content: "B2" },
			{ op: "write", path: "/notes/draft.md", content: "new" },
		]);
	});

	it("tries a change the host refused again, a few times", () => {
		const { vfs, fs } = createSandbox();
		fs.writeFileSync("/a.txt", "a");
		fs.writeFileSync("/b.txt", "b");
		saveAll(vfs);
		fs.unlinkSync("/a.txt");
		fs.writeFileSync("/b.txt", "b2");

		const first = collectSyncBatch(vfs);
		ackSyncBatch(first.batchId, [
			{ index: 0, error: "quota" },
			{ index: 1, error: "quota" },
		]);
		// The file the host still has is deleted again; the write is sent again.
		expect(describeBatch(collectSyncBatch(vfs))).toEqual([
			{ op: "delete", path: "/a.txt", dir: false },
			{ op: "write", path: "/b.txt", content: "b2" },
		]);
	});

	it("sends again a batch lost with the host that asked for it", () => {
		const { vfs, fs } = createSandbox();
		fs.writeFileSync("/a.txt", "a");
		const lost = syncOp("sync.collect", {}, vfs);
		expect(lost.ops).toHaveLength(1);

		const again = syncOp("sync.collect", { orphansFailed: true }, vfs);
		expect(describeBatch(again)).toEqual([
			{ op: "write", path: "/a.txt", content: "a" },
		]);
		expect(getSyncState().inFlight.size).toBe(1);
	});

	it("lets the fs operations change files like any command", async () => {
		const { vfs } = createSandbox();
		const container = { vfs };
		await handleFsOperation(
			"fs.writeFile",
			{ path: "/a/b/c.txt", content: "hi" },
			container,
		);
		await handleFsOperation(
			"fs.rename",
			{ oldPath: "/a/b/c.txt", newPath: "/a/d.txt" },
			container,
		);
		expect(
			await handleFsOperation("fs.readFile", { path: "/a/d.txt" }, container),
		).toEqual({ path: "/a/d.txt", content: "hi" });
		expect(describeBatch(collectSyncBatch(vfs))).toEqual([
			{ op: "mkdir", path: "/a/b" },
			{ op: "write", path: "/a/d.txt", content: "hi" },
		]);
	});
});

describe("sandbox sync: host → sandbox", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal("window", { parent: { postMessage: vi.fn() } });
		resetSyncState();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("applies the host's changes without sending them back", () => {
		const { vfs, fs } = createSandbox();
		const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		const result = applyHostBatch(
			vfs,
			hostBatch([
				{ op: "mkdir", path: "/site/assets" },
				{ op: "write", path: "/site/index.html", content: "<h1>hi</h1>" },
				{ op: "write", path: "/site/assets/og.jpg", content: JPEG },
			]),
		);
		expect(result.changed).toEqual(["/site/index.html", "/site/assets/og.jpg"]);
		expect(fs.readFileSync("/site/index.html", "utf8")).toBe("<h1>hi</h1>");
		expect(fs.readFileSync("/site/assets/og.jpg")).toEqual(JPEG);
		expect(collectSyncBatch(vfs).ops).toEqual([]);

		applyHostBatch(
			vfs,
			hostBatch([
				{ op: "rename", from: "/site/index.html", to: "/site/home.html" },
				{ op: "delete", path: "/site/assets" },
			]),
		);
		expect(fs.readdirSync("/site")).toEqual(["home.html"]);
		expect(collectSyncBatch(vfs).ops).toEqual([]);
		// The host has it: a later change in the sandbox is a write, not a create.
		fs.unlinkSync("/site/home.html");
		expect(collectSyncBatch(vfs).ops).toEqual([
			{ op: "delete", path: "/site/home.html", dir: false },
		]);
	});

	it("keeps the sandbox's unsaved change over the host's, until it is saved", () => {
		const { vfs, fs } = createSandbox();
		applyHostBatch(
			vfs,
			hostBatch([{ op: "write", path: "/a.txt", content: "host 1" }]),
		);
		fs.writeFileSync("/a.txt", "sandbox");

		// The host changed it before the sandbox's change reached it: the
		// sandbox's is saved after, so it is the one both keep.
		expect(
			applyHostBatch(
				vfs,
				hostBatch([{ op: "write", path: "/a.txt", content: "host 2" }]),
			).skipped,
		).toEqual(["/a.txt"]);
		const batch = collectSyncBatch(vfs);
		expect(
			applyHostBatch(vfs, hostBatch([{ op: "delete", path: "/a.txt" }]))
				.skipped,
		).toEqual(["/a.txt"]);
		expect(fs.readFileSync("/a.txt", "utf8")).toBe("sandbox");

		ackSyncBatch(batch.batchId, []);
		applyHostBatch(
			vfs,
			hostBatch([{ op: "write", path: "/a.txt", content: "host 3" }]),
		);
		expect(fs.readFileSync("/a.txt", "utf8")).toBe("host 3");
	});

	it("lists a file too large to copy, and fails its read until it arrives", () => {
		const { vfs, fs } = createSandbox();
		applyHostBatch(
			vfs,
			hostBatch([{ op: "stub", path: "/data/big.csv", size: 50_000_000 }]),
		);
		expect(fs.readdirSync("/data")).toEqual(["big.csv"]);
		expect(fs.statSync("/data/big.csv").size).toBe(50_000_000);
		expect(() => fs.readFileSync("/data/big.csv")).toThrow(
			"Workspace file not materialized: /data/big.csv",
		);
		expect(syncOp("sync.stubs", { root: "/data" }, vfs)).toEqual({
			stubs: [{ path: "/data/big.csv", size: 50_000_000 }],
		});
		// Moved in the sandbox, the host moves it too: its content stays there.
		fs.renameSync("/data", "/archive");
		const moved = collectSyncBatch(vfs);
		expect(moved.ops).toEqual([
			{ op: "rename", from: "/data", to: "/archive" },
		]);
		ackSyncBatch(moved.batchId, []);

		applyHostBatch(
			vfs,
			hostBatch([{ op: "write", path: "/archive/big.csv", content: "a,b" }]),
		);
		expect(fs.readFileSync("/archive/big.csv", "utf8")).toBe("a,b");
	});

	it("ignores a batch meant for a VFS that was replaced", () => {
		const { vfs, fs } = createSandbox();
		const stale = {
			...hostBatch([{ op: "write", path: "/a.txt", content: "x" }]),
			vfsId: "old",
		};
		expect(applyHostBatch(vfs, stale)).toMatchObject({ stale: true });
		expect(fs.existsSync("/a.txt")).toBe(false);
	});
});

describe("sandbox package result normalization", () => {
	it("converts provider-native package maps into stable version records", () => {
		runtimeState.installedPackages.clear();
		const normalized = rememberInstalledPackages({
			installed: new Map([
				["lodash", { name: "lodash", version: "4.17.21" }],
				["nanoid", { name: "nanoid", version: "5.1.5" }],
			]),
			added: ["lodash", "nanoid"],
		});

		expect(normalized).toEqual({ lodash: "4.17.21", nanoid: "5.1.5" });
		expect(Object.fromEntries(runtimeState.installedPackages)).toEqual(
			normalized,
		);
	});
});
