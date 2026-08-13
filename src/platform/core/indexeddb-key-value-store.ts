import type { KeyValueStore } from "../contracts/core";

interface StoreBroadcast {
	source: string;
	key: string;
	value: unknown | null;
}

export interface IndexedDbKeyValueStoreOptions {
	databaseName: string;
	storeName?: string;
	channelName?: string;
}

export class IndexedDbKeyValueStore implements KeyValueStore {
	private readonly storeName: string;
	private readonly source = crypto.randomUUID();
	private readonly listeners = new Map<
		string,
		Set<(value: unknown | null) => void>
	>();
	private readonly database: Promise<IDBDatabase>;
	private readonly channel: BroadcastChannel | null;

	constructor(options: IndexedDbKeyValueStoreOptions) {
		this.storeName = options.storeName ?? "kv";
		this.database = this.open(options.databaseName);
		this.channel =
			typeof BroadcastChannel === "undefined"
				? null
				: new BroadcastChannel(
						options.channelName ?? `${options.databaseName}:changes`,
					);
		this.channel?.addEventListener(
			"message",
			(event: MessageEvent<StoreBroadcast>) => {
				if (!event.data || event.data.source === this.source) return;
				this.emit(event.data.key, event.data.value);
			},
		);
	}

	async get<T>(key: string): Promise<T | null> {
		const request = (await this.transaction("readonly")).get(key);
		return await new Promise<T | null>((resolve, reject) => {
			request.onsuccess = () =>
				resolve(request.result === undefined ? null : (request.result as T));
			request.onerror = () => reject(request.error);
		});
	}

	async set<T>(key: string, value: T): Promise<void> {
		const request = (await this.transaction("readwrite")).put(value, key);
		await this.complete(request);
		this.publish(key, value);
	}

	async remove(key: string): Promise<void> {
		const request = (await this.transaction("readwrite")).delete(key);
		await this.complete(request);
		this.publish(key, null);
	}

	subscribe<T>(key: string, listener: (value: T | null) => void): () => void {
		let listeners = this.listeners.get(key);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(key, listeners);
		}
		listeners.add(listener as (value: unknown | null) => void);
		return () => {
			listeners?.delete(listener as (value: unknown | null) => void);
			if (listeners?.size === 0) this.listeners.delete(key);
		};
	}

	close(): void {
		this.channel?.close();
		void this.database.then((database) => database.close());
	}

	private open(databaseName: string): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(databaseName, 1);
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(this.storeName)) {
					request.result.createObjectStore(this.storeName);
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	private async transaction(mode: IDBTransactionMode): Promise<IDBObjectStore> {
		return (await this.database)
			.transaction(this.storeName, mode)
			.objectStore(this.storeName);
	}

	private complete(request: IDBRequest): Promise<void> {
		return new Promise((resolve, reject) => {
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
	}

	private publish(key: string, value: unknown | null): void {
		this.emit(key, value);
		this.channel?.postMessage({
			source: this.source,
			key,
			value,
		} satisfies StoreBroadcast);
	}

	private emit(key: string, value: unknown | null): void {
		for (const listener of this.listeners.get(key) ?? []) listener(value);
	}
}
