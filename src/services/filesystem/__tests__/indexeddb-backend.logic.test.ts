import { fs as vfs, mount, umount } from "@zenfs/core";
import type { StoreFS } from "@zenfs/core";
import type { IndexedDBStore } from "@zenfs/dom";
import { afterEach, describe, expect, it } from "vitest";
import { TransactionScopedIndexedDB } from "../indexeddb-backend";

/**
 * A minimal IndexedDB: one object store per database, requests that resolve
 * on a later task, and data that outlives connections and transactions.
 */
type Request<T> = {
	result?: T;
	error: unknown;
	onsuccess?: () => void;
	onerror?: (event: { preventDefault(): void }) => void;
	onupgradeneeded?: () => void;
};

const request = <T>(run: () => T): Request<T> => {
	const req: Request<T> = { error: null };
	setTimeout(() => {
		req.result = run();
		req.onsuccess?.();
	});
	return req;
};

const createIndexedDB = () => {
	const databases = new Map<string, Map<number, Uint8Array>>();
	const open = (name: string) => {
		const isNew = !databases.has(name);
		const data = databases.get(name) ?? new Map<number, Uint8Array>();
		databases.set(name, data);
		// Values are copied in and out, like IndexedDB's structured clone.
		const objectStore = {
			get: (id: number) =>
				request(() => {
					const value = data.get(id);
					return value && new Uint8Array(value);
				}),
			put: (value: Uint8Array, id: number) =>
				request(() => {
					data.set(id, new Uint8Array(value));
				}),
			delete: (id: number) => request(() => data.delete(id)),
			getAllKeys: () => request(() => [...data.keys()]),
		};
		const db = {
			name,
			objectStoreNames: { contains: () => !isNew },
			createObjectStore: () => objectStore,
			deleteObjectStore: () => undefined,
			transaction: () => {
				const tx = {
					objectStore: () => objectStore,
					oncomplete: undefined as undefined | (() => void),
					onabort: undefined as undefined | (() => void),
					commit: () => setTimeout(() => tx.oncomplete?.()),
					abort: () => setTimeout(() => tx.onabort?.()),
				};
				return tx;
			},
		};
		const req = request(() => db);
		if (isNew) setTimeout(() => req.onupgradeneeded?.());
		return req;
	};
	return { factory: { open } as unknown as IDBFactory, databases };
};

const MOUNT = "/scoped";

const mountStore = async (factory: IDBFactory) => {
	const fs = (await TransactionScopedIndexedDB.create({
		idbFactory: factory,
		storeName: "home",
	})) as StoreFS<IndexedDBStore>;
	await fs.ready();
	mount(MOUNT, fs);
	return fs;
};

afterEach(() => {
	try {
		umount(MOUNT);
	} catch {
		// Not mounted.
	}
});

describe("TransactionScopedIndexedDB", () => {
	it("keeps no file contents in memory after an operation", async () => {
		const { factory } = createIndexedDB();
		const fs = await mountStore(factory);

		await vfs.promises.mkdir(`${MOUNT}/docs`);
		await vfs.promises.writeFile(`${MOUNT}/docs/a.txt`, "first");
		await vfs.promises.writeFile(`${MOUNT}/docs/b.bin`, new Uint8Array(4096));
		expect(await vfs.promises.readFile(`${MOUNT}/docs/a.txt`, "utf8")).toBe(
			"first",
		);

		const { store } = fs as unknown as { store: IndexedDBStore };
		expect(store.cache.size).toBe(0);
	});

	it("finds existing files after a remount instead of starting a new root", async () => {
		const { factory } = createIndexedDB();
		await mountStore(factory);
		await vfs.promises.mkdir(`${MOUNT}/notes`);
		await vfs.promises.writeFile(`${MOUNT}/notes/today.md`, "# kept");
		umount(MOUNT);

		await mountStore(factory);
		expect(await vfs.promises.readdir(`${MOUNT}/notes`)).toEqual(["today.md"]);
		expect(await vfs.promises.readFile(`${MOUNT}/notes/today.md`, "utf8")).toBe(
			"# kept",
		);
	});

	it("updates metadata in place", async () => {
		const { factory } = createIndexedDB();
		await mountStore(factory);
		await vfs.promises.writeFile(`${MOUNT}/file.txt`, "x");
		const when = new Date("2026-01-02T03:04:05Z");

		await vfs.promises.utimes(`${MOUNT}/file.txt`, when, when);

		expect((await vfs.promises.stat(`${MOUNT}/file.txt`)).mtime.getTime()).toBe(
			when.getTime(),
		);
		expect(await vfs.promises.readFile(`${MOUNT}/file.txt`, "utf8")).toBe("x");
	});
});
