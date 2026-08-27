import { beforeEach, describe, expect, it, vi } from "vitest";
import { installIdbFastSync } from "../idb-fast-sync";

interface FsEntry {
	timestamp: Date;
	mode?: number;
	contents?: string;
}

const MOUNT = { mountpoint: "memorall-db" };

/**
 * The smallest shape of Emscripten's IDBFS that the fast-sync patch touches,
 * plus an IndexedDB store that only answers the batched read API.
 */
function createIdbFs(remote: Record<string, FsEntry> = {}) {
	const local: Record<string, FsEntry> = {};
	const stored: Record<string, FsEntry> = { ...remote };
	const calls = {
		cursorScans: 0,
		batchReads: 0,
		reconciles: 0,
		storedLocal: [] as string[],
		removedLocal: [] as string[],
	};
	let failNextRead = false;

	const database = {
		transaction: () => {
			const requests: { name: string; result: unknown }[] = [];
			const transaction: Record<string, unknown> = {
				error: null,
				objectStore: () => ({
					getAllKeys: (range: { lower?: string } | null, count: number) => {
						const request = { name: "keys", result: [] as string[] };
						requests.push(request);
						request.result = keysAfter(range, count);
						return request;
					},
					getAll: (range: { lower?: string } | null, count: number) => {
						const request = { name: "values", result: [] as FsEntry[] };
						requests.push(request);
						request.result = keysAfter(range, count).map((key) => stored[key]);
						return request;
					},
				}),
			};
			queueMicrotask(() => {
				if (failNextRead) {
					failNextRead = false;
					(
						transaction.onerror as (event: { preventDefault(): void }) => void
					)?.({ preventDefault: () => undefined });
					return;
				}
				calls.batchReads += 1;
				(transaction.oncomplete as () => void)?.();
			});
			return transaction;
		},
	};

	const keysAfter = (range: { lower?: string } | null, count: number) => {
		const keys = Object.keys(stored).sort();
		const start = range?.lower ? keys.findIndex((k) => k > range.lower!) : 0;
		if (start < 0) return [];
		return keys.slice(start, start + count);
	};

	const idbfs = {
		DB_STORE_NAME: "FILE_DATA",
		syncfs: vi.fn(
			(
				_mount: typeof MOUNT,
				_populate: boolean,
				callback: (error: unknown) => void,
			) => callback(null),
		),
		getLocalSet: (
			_mount: typeof MOUNT,
			callback: (error: unknown, set?: unknown) => void,
		) => callback(null, { type: "local", entries: { ...local } }),
		getRemoteSet: (
			_mount: typeof MOUNT,
			callback: (error: unknown, set?: unknown) => void,
		) => {
			calls.cursorScans += 1;
			const entries: Record<string, FsEntry> = {};
			for (const [path, entry] of Object.entries(stored)) {
				entries[path] = { timestamp: entry.timestamp };
			}
			callback(null, { type: "remote", db: database, entries });
		},
		getDB: (_name: string, callback: (error: unknown, db?: unknown) => void) =>
			callback(null, database),
		reconcile: (
			source: { entries: Record<string, FsEntry> },
			_destination: unknown,
			callback: (error: unknown) => void,
		) => {
			calls.reconciles += 1;
			for (const key of Object.keys(stored)) {
				if (!(key in source.entries)) delete stored[key];
			}
			for (const [path, entry] of Object.entries(source.entries)) {
				stored[path] = { ...(local[path] ?? entry) };
			}
			callback(null);
		},
		storeLocalEntry: (
			path: string,
			entry: FsEntry,
			callback: (error: unknown) => void,
		) => {
			calls.storedLocal.push(path);
			local[path] = { ...entry };
			callback(null);
		},
		removeLocalEntry: (path: string, callback: (error: unknown) => void) => {
			calls.removedLocal.push(path);
			delete local[path];
			callback(null);
		},
	};

	return {
		module: { FS: { filesystems: { IDBFS: idbfs } } },
		idbfs,
		local,
		stored,
		calls,
		failNextRead: () => {
			failNextRead = true;
		},
	};
}

// The harness deliberately implements only the slice of IDBFS the patch calls,
// so it is handed over untyped.
const install = (harness: { module: unknown }) =>
	installIdbFastSync(
		harness.module as Parameters<typeof installIdbFastSync>[0],
	);

const sync = (idbfs: { syncfs: Function }, populate: boolean) =>
	new Promise<unknown>((resolve) =>
		idbfs.syncfs(MOUNT, populate, (error: unknown) => resolve(error)),
	);

beforeEach(() => {
	(globalThis as Record<string, unknown>).IDBKeyRange = {
		lowerBound: (lower: string, open: boolean) => ({ lower, lowerOpen: open }),
	};
});

describe("installIdbFastSync", () => {
	it("scans stored keys once and serves later syncs from the cached manifest", async () => {
		const harness = createIdbFs({
			"/a": { timestamp: new Date(1) },
		});
		install(harness);

		harness.local["/a"] = { timestamp: new Date(2) };
		expect(await sync(harness.idbfs, false)).toBeNull();
		expect(harness.calls.cursorScans).toBe(1);

		harness.local["/b"] = { timestamp: new Date(3) };
		expect(await sync(harness.idbfs, false)).toBeNull();
		expect(await sync(harness.idbfs, false)).toBeNull();

		// The manifest is known after the first sync, so no further key cursor.
		expect(harness.calls.cursorScans).toBe(1);
		expect(harness.calls.reconciles).toBe(3);
		expect(Object.keys(harness.stored).sort()).toEqual(["/a", "/b"]);
	});

	it("rescans after a failed sync rather than trusting a stale manifest", async () => {
		const harness = createIdbFs({ "/a": { timestamp: new Date(1) } });
		install(harness);

		await sync(harness.idbfs, false);
		expect(harness.calls.cursorScans).toBe(1);

		harness.idbfs.reconcile = (
			_source: unknown,
			_destination: unknown,
			callback: (error: unknown) => void,
		) => callback(new Error("write failed"));
		expect(await sync(harness.idbfs, false)).toBeInstanceOf(Error);

		harness.idbfs.reconcile = (
			_source: unknown,
			_destination: unknown,
			callback: (error: unknown) => void,
		) => callback(null);
		await sync(harness.idbfs, false);
		expect(harness.calls.cursorScans).toBe(2);
	});

	it("populates from batched reads and drops files that are no longer stored", async () => {
		const harness = createIdbFs({
			"/keep": { timestamp: new Date(10), contents: "keep" },
			"/new": { timestamp: new Date(11), contents: "new" },
		});
		install(harness);
		harness.local["/keep"] = { timestamp: new Date(10), contents: "keep" };
		harness.local["/gone"] = { timestamp: new Date(1), contents: "gone" };

		expect(await sync(harness.idbfs, true)).toBeNull();

		// Unchanged files are left alone, missing ones restored, extras removed.
		expect(harness.calls.storedLocal).toEqual(["/new"]);
		expect(harness.calls.removedLocal).toEqual(["/gone"]);
		expect(Object.keys(harness.local).sort()).toEqual(["/keep", "/new"]);
		expect(harness.calls.cursorScans).toBe(0);

		// The populate seeds the manifest, so the next push does not scan either.
		await sync(harness.idbfs, false);
		expect(harness.calls.cursorScans).toBe(0);
	});

	it("reports a failed batch read instead of caching a partial manifest", async () => {
		const harness = createIdbFs({ "/a": { timestamp: new Date(1) } });
		install(harness);
		harness.failNextRead();

		expect(await sync(harness.idbfs, true)).toBeTruthy();
		await sync(harness.idbfs, false);
		expect(harness.calls.cursorScans).toBe(1);
	});

	it("leaves a filesystem it does not recognise untouched", () => {
		const original = () => undefined;
		const idbfs = { syncfs: original };
		install({ module: { FS: { filesystems: { IDBFS: idbfs } } } });
		expect(idbfs.syncfs).toBe(original);
		expect(() => installIdbFastSync({})).not.toThrow();
	});
});
