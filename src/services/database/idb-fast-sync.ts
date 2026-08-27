import type { Extension } from "@electric-sql/pglite";

/**
 * PGlite's `idb://` filesystem persists through Emscripten's IDBFS, which is
 * written for correctness rather than for the shape of a Postgres data
 * directory (~2,800 files for a freshly initialised cluster):
 *
 *  - every `syncfs()` rebuilds the remote manifest by stepping an IndexedDB key
 *    cursor across all of those records, and PGlite calls `syncfs()` after every
 *    statement;
 *  - the initial populate then reads each record with its own `get()`.
 *
 * Chromium answers those in microseconds so the cost hides. WebKit and Firefox
 * round-trip each request, so on the production Web bundle a single statement
 * cost ~15s in WebKit and the 16 start-up migrations took ~9 minutes - the app
 * never finished loading. Both problems are fixed here:
 *
 *  - the remote manifest is cached, because we are the only writer and a
 *    successful sync leaves both sides equal to the set that was just applied;
 *  - the populate reads records in batches with `getAll`/`getAllKeys` instead of
 *    one request per file.
 *
 * Measured against the production Web bundle in Playwright WebKit:
 * per-statement sync 15,000ms -> ~55ms, start-up migrations ~9min -> ~4s.
 * Chromium and Firefox improve on the same paths.
 *
 * Anything unexpected falls back to the stock IDBFS behaviour.
 */

interface FsEntry {
	timestamp: Date;
	mode?: number;
	contents?: Uint8Array;
}

interface FsEntrySet {
	type: "local" | "remote";
	db?: IDBDatabase;
	entries: Record<string, FsEntry>;
}

interface IdbMount {
	mountpoint: string;
}

type SetCallback = (error: unknown, set?: FsEntrySet) => void;
type DoneCallback = (error: unknown) => void;

interface EmscriptenIdbFs {
	DB_STORE_NAME: string;
	syncfs: (mount: IdbMount, populate: boolean, callback: DoneCallback) => void;
	getLocalSet: (mount: IdbMount, callback: SetCallback) => void;
	getRemoteSet: (mount: IdbMount, callback: SetCallback) => void;
	getDB: (
		name: string,
		callback: (error: unknown, db?: IDBDatabase) => void,
	) => void;
	reconcile: (
		source: FsEntrySet,
		destination: FsEntrySet,
		callback: DoneCallback,
	) => void;
	storeLocalEntry: (
		path: string,
		entry: FsEntry,
		callback: DoneCallback,
	) => void;
	removeLocalEntry: (path: string, callback: DoneCallback) => void;
	__memorallFastSync?: boolean;
}

interface EmscriptenFsModule {
	FS?: { filesystems?: { IDBFS?: EmscriptenIdbFs } };
}

// Large enough to collapse thousands of round trips, small enough that a batch
// of Postgres relation segments stays a sane amount of memory to hold at once.
const READ_BATCH_SIZE = 64;

export function installIdbFastSync(module: EmscriptenFsModule): void {
	const idbfs = module.FS?.filesystems?.IDBFS;
	if (!idbfs || idbfs.__memorallFastSync) return;
	if (
		typeof idbfs.syncfs !== "function" ||
		typeof idbfs.getLocalSet !== "function" ||
		typeof idbfs.getRemoteSet !== "function" ||
		typeof idbfs.reconcile !== "function" ||
		typeof idbfs.storeLocalEntry !== "function" ||
		typeof idbfs.removeLocalEntry !== "function"
	) {
		return;
	}
	idbfs.__memorallFastSync = true;

	const manifests = new Map<string, Record<string, FsEntry>>();
	const readRemoteSet = idbfs.getRemoteSet.bind(idbfs);
	const stockSyncfs = idbfs.syncfs.bind(idbfs);

	const resolveRemoteSet = (mount: IdbMount, callback: SetCallback) => {
		const entries = manifests.get(mount.mountpoint);
		if (!entries) {
			readRemoteSet(mount, callback);
			return;
		}
		idbfs.getDB(mount.mountpoint, (error, db) => {
			if (error || !db) {
				manifests.delete(mount.mountpoint);
				readRemoteSet(mount, callback);
				return;
			}
			callback(null, { type: "remote", db, entries: { ...entries } });
		});
	};

	/**
	 * Walks the whole store in ascending key order, `READ_BATCH_SIZE` records at
	 * a time. Both requests of a batch are issued in the same task so the
	 * transaction stays active, and each batch opens a fresh transaction so no
	 * assumption is made about how long a browser keeps one alive.
	 */
	const readAllRecords = (
		db: IDBDatabase,
		onRecord: (path: string, entry: FsEntry) => void,
		done: DoneCallback,
	) => {
		let after: IDBValidKey | null = null;
		const readBatch = () => {
			let transaction: IDBTransaction;
			try {
				transaction = db.transaction([idbfs.DB_STORE_NAME], "readonly");
			} catch (error) {
				done(error);
				return;
			}
			const store = transaction.objectStore(idbfs.DB_STORE_NAME);
			const range = after === null ? null : IDBKeyRange.lowerBound(after, true);
			const keysRequest = store.getAllKeys(range, READ_BATCH_SIZE);
			const valuesRequest = store.getAll(range, READ_BATCH_SIZE);
			transaction.onabort = transaction.onerror = (event) => {
				event.preventDefault();
				done(transaction.error ?? new Error("IDBFS batch read failed"));
			};
			transaction.oncomplete = () => {
				const keys = keysRequest.result ?? [];
				const values = valuesRequest.result ?? [];
				if (keys.length === 0) {
					done(null);
					return;
				}
				for (let index = 0; index < keys.length; index += 1) {
					const entry = values[index] as FsEntry | undefined;
					if (entry) onRecord(`${keys[index]}`, entry);
				}
				after = keys[keys.length - 1];
				readBatch();
			};
		};
		readBatch();
	};

	const populateFromRemote = (
		mount: IdbMount,
		local: FsEntrySet,
		callback: DoneCallback,
	) => {
		idbfs.getDB(mount.mountpoint, (error, db) => {
			if (error || !db) {
				stockSyncfs(mount, true, callback);
				return;
			}
			const manifest: Record<string, FsEntry> = {};
			let failure: unknown = null;
			const report = (storeError: unknown) => {
				if (storeError && !failure) failure = storeError;
			};
			readAllRecords(
				db,
				(path, entry) => {
					manifest[path] = { timestamp: entry.timestamp };
					if (failure) return;
					const current = local.entries[path];
					if (
						current &&
						current.timestamp.getTime() === entry.timestamp.getTime()
					) {
						return;
					}
					// IDB primary keys arrive in ascending path order, so parents are
					// always restored before their children.
					idbfs.storeLocalEntry(path, entry, report);
				},
				(readError) => {
					const stale = Object.keys(local.entries)
						.filter((path) => !(path in manifest))
						.sort()
						.reverse();
					if (!readError && !failure) {
						for (const path of stale) idbfs.removeLocalEntry(path, report);
					}
					const outcome = readError ?? failure;
					if (outcome) {
						manifests.delete(mount.mountpoint);
						callback(outcome);
						return;
					}
					manifests.set(mount.mountpoint, manifest);
					callback(null);
				},
			);
		});
	};

	idbfs.syncfs = (mount, populate, callback) => {
		idbfs.getLocalSet(mount, (localError, local) => {
			if (localError || !local) {
				callback(localError ?? new Error("IDBFS local set unavailable"));
				return;
			}
			if (populate) {
				populateFromRemote(mount, local, callback);
				return;
			}
			resolveRemoteSet(mount, (remoteError, remote) => {
				if (remoteError || !remote) {
					manifests.delete(mount.mountpoint);
					callback(remoteError ?? new Error("IDBFS remote set unavailable"));
					return;
				}
				idbfs.reconcile(local, remote, (reconcileError) => {
					if (reconcileError) {
						manifests.delete(mount.mountpoint);
						callback(reconcileError);
						return;
					}
					// Storage now matches the local set that was just pushed.
					manifests.set(mount.mountpoint, local.entries);
					callback(null);
				});
			});
		});
	};
}

/**
 * Installed as a PGlite extension only to reach Emscripten's `preRun`, the last
 * hook before PGlite's own `initialSyncFs()`, so even the first populate of a
 * page load takes the batched path.
 */
export const idbFastSyncExtension: Extension = {
	name: "memorall-idb-fast-sync",
	setup: async (_pg, emscriptenOpts) => ({
		emscriptenOpts: {
			...emscriptenOpts,
			preRun: [
				...(emscriptenOpts?.preRun ?? []),
				(module: EmscriptenFsModule) => installIdbFastSync(module),
			],
		},
	}),
};
