import { StoreFS } from "@zenfs/core";
import {
	IndexedDB,
	IndexedDBStore,
	IndexedDBTransaction,
	type IndexedDBOptions,
} from "@zenfs/dom";

/**
 * `@zenfs/dom`'s IndexedDB backend, holding file contents in memory only for
 * the length of one transaction.
 *
 * The stock store keeps a single cache Map for its whole life. Mounting fills
 * it with every file in the store (unless `disableAsyncCache` is set), and
 * every file read or written later stays in it as well — so each context that
 * mounted `/home` (the service worker, the offscreen document, every open
 * page) held the user's whole library, again after every remount.
 *
 * StoreFS needs that cache only within one transaction: its synchronous steps
 * (`setSync` in `touch`, rollback stashes) follow an async read of the same key
 * in the same transaction. So each transaction gets a cache of its own, and
 * the bytes go with it.
 */
class TransactionScopedStore extends IndexedDBStore {
	override transaction(): IndexedDBTransaction {
		const scope = Object.create(this, {
			cache: { value: new Map<number, Uint8Array>() },
		}) as IndexedDBStore;
		return new IndexedDBTransaction(
			this.db.transaction(this.name, "readwrite"),
			scope,
		);
	}
}

const openDatabase = (
	name: string,
	idbFactory: IDBFactory = globalThis.indexedDB,
): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = idbFactory.open(name);
		// Same layout as `@zenfs/dom`, so existing stores open unchanged.
		request.onupgradeneeded = () => {
			const db = request.result;
			if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
			db.createObjectStore(name);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

export const TransactionScopedIndexedDB: typeof IndexedDB = {
	...IndexedDB,
	async create(options: IndexedDBOptions) {
		const db = await openDatabase(
			options.storeName || "zenfs",
			options.idbFactory,
		);
		const fs = new StoreFS<IndexedDBStore>(new TransactionScopedStore(db));
		// Required, not an optimisation: without it `ready()` checks the root
		// through the (empty) sync cache, finds nothing, and writes a new empty
		// root over the existing one.
		fs.attributes.set("no_async_preload");
		return fs;
	},
};
