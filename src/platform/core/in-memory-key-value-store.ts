import type { KeyValueStore } from "../contracts/core";

export class InMemoryKeyValueStore implements KeyValueStore {
	private readonly values = new Map<string, unknown>();
	private readonly listeners = new Map<
		string,
		Set<(value: unknown | null) => void>
	>();

	async get<T>(key: string): Promise<T | null> {
		return this.values.has(key) ? (this.values.get(key) as T) : null;
	}

	async set<T>(key: string, value: T): Promise<void> {
		this.values.set(key, value);
		this.emit(key, value);
	}

	async remove(key: string): Promise<void> {
		this.values.delete(key);
		this.emit(key, null);
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

	private emit(key: string, value: unknown | null): void {
		for (const listener of this.listeners.get(key) ?? []) listener(value);
	}
}
