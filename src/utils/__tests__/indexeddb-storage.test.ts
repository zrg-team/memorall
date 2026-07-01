import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IndexedDBLogStorage, type LogEntry } from "../indexeddb-storage";

type TestRange = { lower?: number; upper?: number };

const records: LogEntry[] = [];

const createRequest = <T>(executor: () => T): IDBRequest<T> => {
	const request = {
		result: undefined as T | undefined,
		error: null,
		onsuccess: null as ((event: Event) => void) | null,
		onerror: null as (() => void) | null,
	} as IDBRequest<T>;

	queueMicrotask(() => {
		try {
			(request as any).result = executor();
			request.onsuccess?.({ target: request } as any);
		} catch (error) {
			(request as any).error = error;
			request.onerror?.({ target: request } as any);
		}
	});

	return request;
};

const matchesRange = (entry: LogEntry, range?: TestRange) => {
	if (!range) return true;
	if (range.lower !== undefined && entry.timestamp < range.lower) return false;
	if (range.upper !== undefined && entry.timestamp > range.upper) return false;
	return true;
};

const makeStore = () => ({
	createIndex: vi.fn(),
	add: vi.fn((entry: LogEntry) =>
		createRequest(() => {
			records.push(entry);
			return entry.id as any;
		}),
	),
	getAll: vi.fn((range?: TestRange) =>
		createRequest(() => records.filter((entry) => matchesRange(entry, range))),
	),
	clear: vi.fn(() =>
		createRequest(() => {
			records.length = 0;
			return undefined as any;
		}),
	),
	count: vi.fn(() => createRequest(() => records.length)),
	index: vi.fn(() => ({
		getAll: (range?: TestRange) =>
			createRequest(() =>
				records.filter((entry) => matchesRange(entry, range)),
			),
		openCursor: (range?: TestRange) => {
			const matches = records.filter((entry) => matchesRange(entry, range));
			const request = {
				result: undefined,
				error: null,
				onsuccess: null as ((event: Event) => void) | null,
				onerror: null as (() => void) | null,
			} as IDBRequest;
			let index = 0;
			const advance = () => {
				const entry = matches[index++];
				(request as any).result = entry
					? {
							delete: () => {
								const recordIndex = records.findIndex(
									(record) => record.id === entry.id,
								);
								if (recordIndex >= 0) records.splice(recordIndex, 1);
							},
							continue: () => queueMicrotask(advance),
						}
					: null;
				request.onsuccess?.({ target: request } as any);
			};
			queueMicrotask(advance);
			return request;
		},
	})),
});

const installIndexedDB = () => {
	const store = makeStore();
	const db = {
		objectStoreNames: { contains: vi.fn(() => false) },
		createObjectStore: vi.fn(() => store),
		transaction: vi.fn(() => ({ objectStore: vi.fn(() => store) })),
	};

	Object.defineProperty(globalThis, "IDBKeyRange", {
		configurable: true,
		value: {
			bound: (lower: number, upper: number) => ({ lower, upper }),
			lowerBound: (lower: number) => ({ lower }),
			upperBound: (upper: number) => ({ upper }),
		},
	});

	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: {
			open: vi.fn(() => {
				const request = {
					result: db,
					error: null,
					onsuccess: null as (() => void) | null,
					onerror: null as (() => void) | null,
					onupgradeneeded: null as ((event: Event) => void) | null,
				};
				queueMicrotask(() => {
					request.onupgradeneeded?.({ target: request } as any);
					request.onsuccess?.();
				});
				return request;
			}),
		},
	});

	return { db, store };
};

beforeEach(() => {
	records.length = 0;
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "indexedDB");
	Reflect.deleteProperty(globalThis, "IDBKeyRange");
	vi.clearAllMocks();
});

describe("IndexedDBLogStorage", () => {
	it("reports unavailability and rejects initialization without IndexedDB", async () => {
		const storage = new IndexedDBLogStorage();

		expect(storage.isAvailable()).toBe(false);
		await expect(storage.initialize()).rejects.toThrow(
			"IndexedDB not available",
		);
	});

	it("initializes the database and creates indexes on upgrade", async () => {
		const { db, store } = installIndexedDB();
		const storage = new IndexedDBLogStorage();

		expect(storage.isAvailable()).toBe(true);
		await storage.initialize();
		await storage.initialize();

		expect(indexedDB.open).toHaveBeenCalledWith("MemorallLogs", 1);
		expect(db.createObjectStore).toHaveBeenCalledWith("logs", {
			keyPath: "id",
		});
		expect(store.createIndex).toHaveBeenCalledWith("timestamp", "timestamp", {
			unique: false,
		});
	});

	it("stores, retrieves, filters, sorts, limits, counts, and clears log entries", async () => {
		installIndexedDB();
		const storage = new IndexedDBLogStorage();
		const first: LogEntry = {
			id: "1",
			timestamp: 10,
			level: "info",
			message: "first",
			context: "ctx",
			source: "main",
		};
		const second: LogEntry = {
			id: "2",
			timestamp: 20,
			level: "error",
			message: "second",
			context: "ctx",
			source: "worker",
		};
		const third: LogEntry = {
			id: "3",
			timestamp: 30,
			level: "error",
			message: "third",
			context: "other",
			source: "worker",
		};

		await storage.store(first);
		await storage.store(second);
		await storage.store(third);

		await expect(storage.getStorageSize()).resolves.toBe(3);
		await expect(storage.retrieve()).resolves.toEqual([third, second, first]);
		await expect(
			storage.retrieve({
				level: "error",
				context: "ctx",
				source: "worker",
				limit: 1,
			}),
		).resolves.toEqual([second]);
		await expect(
			storage.retrieve({ startTime: 15, endTime: 30 }),
		).resolves.toEqual([third, second]);

		await storage.clear(20);
		await expect(storage.retrieve()).resolves.toEqual([third]);

		await storage.clear();
		await expect(storage.getStorageSize()).resolves.toBe(0);
	});
});
