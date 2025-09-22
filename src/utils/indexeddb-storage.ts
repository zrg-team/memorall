// Standalone types for IndexedDB log storage
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	id: string;
	timestamp: number;
	level: LogLevel;
	message: string;
	data?: any;
	context?: string;
	source?: string;
}

export interface LogFilter {
	level?: LogLevel;
	startTime?: number;
	endTime?: number;
	context?: string;
	source?: string;
	limit?: number;
}

export interface LogStorage {
	initialize(): Promise<void>;
	store(entry: LogEntry): Promise<void>;
	retrieve(filter?: LogFilter): Promise<LogEntry[]>;
	clear(olderThan?: number): Promise<void>;
	getStorageSize(): Promise<number>;
	isAvailable(): boolean;
}

const DB_NAME = "MemorallLogs";
const DB_VERSION = 1;
const STORE_NAME = "logs";

export class IndexedDBLogStorage implements LogStorage {
	private db: IDBDatabase | null = null;
	private initPromise: Promise<void> | null = null;

	async initialize(): Promise<void> {
		if (this.db) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = new Promise((resolve, reject) => {
			if (!this.isAvailable()) {
				reject(new Error("IndexedDB not available"));
				return;
			}

			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				reject(new Error(`Failed to open IndexedDB: ${request.error}`));
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
					store.createIndex("timestamp", "timestamp", { unique: false });
					store.createIndex("level", "level", { unique: false });
					store.createIndex("context", "context", { unique: false });
					store.createIndex("source", "source", { unique: false });
				}
			};
		});

		return this.initPromise;
	}

	async store(entry: LogEntry): Promise<void> {
		await this.initialize();

		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.add(entry);

			request.onsuccess = () => resolve();
			request.onerror = () =>
				reject(new Error(`Failed to store log entry: ${request.error}`));
		});
	}

	async retrieve(filter?: LogFilter): Promise<LogEntry[]> {
		await this.initialize();

		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORE_NAME], "readonly");
			const store = transaction.objectStore(STORE_NAME);

			let request: IDBRequest;

			if (filter?.startTime || filter?.endTime) {
				const index = store.index("timestamp");
				const range = this.createTimeRange(filter.startTime, filter.endTime);
				request = range ? index.getAll(range) : index.getAll();
			} else {
				request = store.getAll();
			}

			request.onsuccess = () => {
				let results = request.result as LogEntry[];

				if (filter) {
					results = this.applyFilter(results, filter);
				}

				results.sort((a, b) => b.timestamp - a.timestamp);

				if (filter?.limit) {
					results = results.slice(0, filter.limit);
				}

				resolve(results);
			};

			request.onerror = () =>
				reject(new Error(`Failed to retrieve log entries: ${request.error}`));
		});
	}

	async clear(olderThan?: number): Promise<void> {
		await this.initialize();

		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);

			if (olderThan) {
				const index = store.index("timestamp");
				const range = IDBKeyRange.upperBound(olderThan);
				const request = index.openCursor(range);

				request.onsuccess = (event) => {
					const cursor = (event.target as IDBRequest).result;
					if (cursor) {
						cursor.delete();
						cursor.continue();
					} else {
						resolve();
					}
				};

				request.onerror = () =>
					reject(
						new Error(`Failed to clear old log entries: ${request.error}`),
					);
			} else {
				const request = store.clear();
				request.onsuccess = () => resolve();
				request.onerror = () =>
					reject(new Error(`Failed to clear log entries: ${request.error}`));
			}
		});
	}

	async getStorageSize(): Promise<number> {
		await this.initialize();

		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error("Database not initialized"));
				return;
			}

			const transaction = this.db.transaction([STORE_NAME], "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.count();

			request.onsuccess = () => resolve(request.result);
			request.onerror = () =>
				reject(new Error(`Failed to get storage size: ${request.error}`));
		});
	}

	isAvailable(): boolean {
		return typeof indexedDB !== "undefined";
	}

	private createTimeRange(
		startTime?: number,
		endTime?: number,
	): IDBKeyRange | null {
		if (startTime && endTime) {
			return IDBKeyRange.bound(startTime, endTime);
		} else if (startTime) {
			return IDBKeyRange.lowerBound(startTime);
		} else if (endTime) {
			return IDBKeyRange.upperBound(endTime);
		}
		return null;
	}

	private applyFilter(entries: LogEntry[], filter: LogFilter): LogEntry[] {
		return entries.filter((entry) => {
			if (filter.level && entry.level !== filter.level) {
				return false;
			}
			if (filter.context && entry.context !== filter.context) {
				return false;
			}
			if (filter.source && entry.source !== filter.source) {
				return false;
			}
			return true;
		});
	}
}
