import type { FilesystemChangeEvent } from "./document-filesystem";

/**
 * Every change to the documents filesystem, in the order it was made, by any
 * context. Messages between contexts can be late, and a context only sees
 * another's writes once it reloads the store; the journal is what lets a
 * reader be sure it has everything: it reads the newest sequence number, and
 * catches up to it. A change is journaled after its data is saved, so a
 * reader that sees an entry and then loads the store has the change.
 */

export interface FilesystemJournalEntry {
	/** Increasing across every context. */
	seq: number;
	/** The context that made the change. */
	contextId: string;
	at: number;
	/** null: a change nobody can describe (read the whole tree again). */
	change: FilesystemChangeEvent | null;
}

export interface FilesystemChangeJournal {
	append(
		contextId: string,
		change: FilesystemChangeEvent | null,
	): Promise<number>;
	/** The newest sequence number; 0 when nothing was journaled. */
	head(): Promise<number>;
	/**
	 * The entries after `seq`. Not `complete` when some were dropped to keep the
	 * journal small: the reader compares the whole tree instead.
	 */
	since(
		seq: number,
	): Promise<{ entries: FilesystemJournalEntry[]; complete: boolean }>;
}

/** Entries kept; older ones are dropped. */
const KEEP = 10_000;
const TRIM_EVERY = 500;

/** For tests, and where IndexedDB is missing: one context's journal. */
export const createMemoryJournal = (): FilesystemChangeJournal => {
	const entries: FilesystemJournalEntry[] = [];
	let seq = 0;
	let trimmedThrough = 0;
	return {
		async append(contextId, change) {
			seq += 1;
			entries.push({ seq, contextId, at: Date.now(), change });
			if (entries.length > KEEP) {
				const dropped = entries.splice(0, entries.length - KEEP);
				trimmedThrough = dropped.at(-1)?.seq ?? trimmedThrough;
			}
			return seq;
		},
		async head() {
			return seq;
		},
		async since(after) {
			return {
				entries: entries.filter((entry) => entry.seq > after),
				complete: after >= trimmedThrough,
			};
		},
	};
};

const DB_NAME = "memorall-fs-journal";
const ENTRIES = "entries";
const META = "meta";
const TRIMMED = "trimmedThrough";

const promised = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const done = (transaction: IDBTransaction): Promise<void> =>
	new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
		transaction.onabort = () => reject(transaction.error);
	});

/** The journal every context shares, in its own IndexedDB database. */
export const createIndexedDbJournal = (
	name = DB_NAME,
): FilesystemChangeJournal => {
	let database: Promise<IDBDatabase> | null = null;
	const open = () => {
		database ??= new Promise((resolve, reject) => {
			const request = indexedDB.open(name, 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(ENTRIES, {
					keyPath: "seq",
					autoIncrement: true,
				});
				request.result.createObjectStore(META);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => {
				database = null;
				reject(request.error);
			};
		});
		return database;
	};

	const trim = async (seq: number) => {
		const db = await open();
		const transaction = db.transaction([ENTRIES, META], "readwrite");
		const through = seq - KEEP;
		transaction.objectStore(ENTRIES).delete(IDBKeyRange.upperBound(through));
		transaction.objectStore(META).put(through, TRIMMED);
		await done(transaction);
	};

	return {
		async append(contextId, change) {
			const db = await open();
			const transaction = db.transaction(ENTRIES, "readwrite");
			const seq = Number(
				await promised(
					transaction
						.objectStore(ENTRIES)
						.add({ contextId, at: Date.now(), change }),
				),
			);
			await done(transaction);
			if (seq % TRIM_EVERY === 0 && seq > KEEP)
				void trim(seq).catch(() => undefined);
			return seq;
		},
		async head() {
			const db = await open();
			const cursor = await promised(
				db
					.transaction(ENTRIES)
					.objectStore(ENTRIES)
					.openKeyCursor(null, "prev"),
			);
			return cursor ? Number(cursor.key) : 0;
		},
		async since(after) {
			const db = await open();
			const transaction = db.transaction([ENTRIES, META]);
			const [entries, trimmedThrough] = await Promise.all([
				promised(
					transaction
						.objectStore(ENTRIES)
						.getAll(IDBKeyRange.lowerBound(after, true)),
				) as Promise<FilesystemJournalEntry[]>,
				promised(transaction.objectStore(META).get(TRIMMED)) as Promise<
					number | undefined
				>,
			]);
			return { entries, complete: after >= (trimmedThrough ?? 0) };
		},
	};
};

/** The shared journal where IndexedDB exists, a context's own otherwise. */
export const createFilesystemChangeJournal = (): FilesystemChangeJournal =>
	typeof indexedDB === "undefined"
		? createMemoryJournal()
		: createIndexedDbJournal();
