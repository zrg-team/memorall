import type { KeyValueStore } from "../contracts/core";

type StorageAreaName = "local" | "session";

export class ChromeStorageKeyValueStore implements KeyValueStore {
	constructor(private readonly areaName: StorageAreaName) {}

	async get<T>(key: string): Promise<T | null> {
		const result = await this.area().get(key);
		return key in result ? (result[key] as T) : null;
	}

	async set<T>(key: string, value: T): Promise<void> {
		await this.area().set({ [key]: value });
	}

	async remove(key: string): Promise<void> {
		await this.area().remove(key);
	}

	subscribe<T>(key: string, listener: (value: T | null) => void): () => void {
		const handler = (
			changes: Record<string, chrome.storage.StorageChange>,
			areaName: string,
		) => {
			if (areaName !== this.areaName || !(key in changes)) return;
			const next = changes[key]?.newValue;
			listener(next === undefined ? null : (next as T));
		};
		chrome.storage.onChanged.addListener(handler);
		return () => chrome.storage.onChanged.removeListener(handler);
	}

	private area(): chrome.storage.StorageArea {
		if (this.areaName === "session" && chrome.storage.session) {
			return chrome.storage.session;
		}
		return chrome.storage.local;
	}
}
