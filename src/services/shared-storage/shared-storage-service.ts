import { logInfo, logWarn, logError } from "@/utils/logger";

// Event types for storage changes
export interface StorageChangeEvent<T = any> {
	key: string;
	oldValue: T | null;
	newValue: T | null;
	timestamp: number;
}

export type StorageChangeListener<T = any> = (
	event: StorageChangeEvent<T>,
) => void;

/**
 * Shared Storage Service - Universal storage + cross-context notifications
 * Uses IndexedDB (works in all contexts) + messaging for synchronization
 */
export class SharedStorageService {
	private static instance: SharedStorageService;
	private listeners = new Map<string, Set<StorageChangeListener>>();
	private initialized = false;
	private db: IDBDatabase | null = null;
	private readonly DB_NAME = "memorall-shared-storage";
	private readonly STORE_NAME = "kvstore";

	private constructor() {}

	static getInstance(): SharedStorageService {
		if (!SharedStorageService.instance) {
			SharedStorageService.instance = new SharedStorageService();
		}
		return SharedStorageService.instance;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			// Open IndexedDB (works in all contexts including offscreen)
			await this.openDatabase();

			// Listen for custom storage change messages (works in all contexts)
			if (globalThis.chrome?.runtime?.onMessage) {
				chrome.runtime.onMessage.addListener((message) => {
					if (message.type === "STORAGE_CHANGED") {
						const { key, oldValue, newValue } = message;
						this.notifyListeners(key, oldValue, newValue);
					}
				});
			}

			this.initialized = true;
			logInfo(
				"📦 SharedStorageService initialized successfully (IndexedDB + messaging)",
			);
		} catch (error) {
			logError("Failed to initialize SharedStorageService:", error);
			throw error;
		}
	}

	private async openDatabase(): Promise<void> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.DB_NAME, 1);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				this.db = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.STORE_NAME)) {
					db.createObjectStore(this.STORE_NAME);
				}
			};
		});
	}

	/**
	 * Get value from storage
	 */
	async get<T = any>(key: string): Promise<T | null> {
		try {
			if (!this.db) {
				logWarn(`📦 Database not initialized for get: ${key}`);
				return null;
			}

			return new Promise((resolve, reject) => {
				const transaction = this.db!.transaction([this.STORE_NAME], "readonly");
				const store = transaction.objectStore(this.STORE_NAME);
				const request = store.get(key);

				request.onsuccess = () => {
					const value = request.result ?? null;
					logInfo(`📦 Storage get: ${key} has value ${value !== null}`);
					resolve(value);
				};

				request.onerror = () => {
					logError(`Failed to get storage key: ${key}`, request.error);
					reject(request.error);
				};
			});
		} catch (error) {
			logError(`Failed to get storage key: ${key}`, error);
			return null;
		}
	}

	/**
	 * Set value in storage with change notification
	 */
	async set<T = any>(key: string, value: T): Promise<void> {
		try {
			if (!this.db) {
				logWarn(`📦 Database not initialized for set: ${key}`);
				return;
			}

			// Get old value for change event
			const oldValue = await this.get(key);

			// Store in IndexedDB
			await new Promise<void>((resolve, reject) => {
				const transaction = this.db!.transaction(
					[this.STORE_NAME],
					"readwrite",
				);
				const store = transaction.objectStore(this.STORE_NAME);
				const request = store.put(value, key);

				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});

			logInfo(`📦 Storage set: ${key}`);

			// Notify other contexts via message
			this.broadcastStorageChange(key, oldValue, value);
		} catch (error) {
			logError(`Failed to set storage key: ${key}`, error);
			throw error;
		}
	}

	/**
	 * Remove key from storage
	 */
	async remove(key: string): Promise<void> {
		try {
			if (!this.db) {
				logWarn(`📦 Database not initialized for remove: ${key}`);
				return;
			}

			// Get old value for change event
			const oldValue = await this.get(key);

			// Remove from IndexedDB
			await new Promise<void>((resolve, reject) => {
				const transaction = this.db!.transaction(
					[this.STORE_NAME],
					"readwrite",
				);
				const store = transaction.objectStore(this.STORE_NAME);
				const request = store.delete(key);

				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});

			logInfo(`📦 Storage remove: ${key}`);

			// Notify other contexts via message
			this.broadcastStorageChange(key, oldValue, null);
		} catch (error) {
			logError(`Failed to remove storage key: ${key}`, error);
			throw error;
		}
	}

	/**
	 * Subscribe to changes for a specific key
	 */
	subscribe<T = any>(
		key: string,
		listener: StorageChangeListener<T>,
	): () => void {
		if (!this.listeners.has(key)) {
			this.listeners.set(key, new Set());
		}

		this.listeners.get(key)!.add(listener as StorageChangeListener);

		logInfo(`📦 Added storage listener for key: ${key}`);

		// Return unsubscribe function
		return () => {
			const keyListeners = this.listeners.get(key);
			if (keyListeners) {
				keyListeners.delete(listener as StorageChangeListener);
				if (keyListeners.size === 0) {
					this.listeners.delete(key);
				}
			}
			logInfo(`📦 Removed storage listener for key: ${key}`);
		};
	}

	/**
	 * Broadcast storage change to other contexts
	 */
	private broadcastStorageChange<T = any>(
		key: string,
		oldValue: T | null,
		newValue: T | null,
	): void {
		try {
			chrome.runtime
				.sendMessage({
					type: "STORAGE_CHANGED",
					key,
					oldValue,
					newValue,
					timestamp: Date.now(),
				})
				.catch(() => {
					// Ignore errors - context might not be available to receive
				});
		} catch (error) {
			// Ignore broadcast errors in contexts where runtime is not available
		}
	}

	/**
	 * Notify local listeners of storage changes
	 */
	private notifyListeners<T = any>(
		key: string,
		oldValue: T | null,
		newValue: T | null,
	): void {
		const keyListeners = this.listeners.get(key);
		if (!keyListeners || keyListeners.size === 0) return;

		const event: StorageChangeEvent<T> = {
			key,
			oldValue,
			newValue,
			timestamp: Date.now(),
		};

		logInfo(`📦 Notifying ${keyListeners.size} listeners for key: ${key}`);

		keyListeners.forEach((listener) => {
			try {
				listener(event);
			} catch (error) {
				logError(`Storage listener error for key ${key}:`, error);
			}
		});
	}

	/**
	 * Check if storage is available
	 */
	isAvailable(): boolean {
		return !!this.db;
	}

	/**
	 * Get all keys (for debugging)
	 */
	async getAllKeys(): Promise<string[]> {
		try {
			if (!this.db) return [];

			return new Promise((resolve, reject) => {
				const transaction = this.db!.transaction([this.STORE_NAME], "readonly");
				const store = transaction.objectStore(this.STORE_NAME);
				const request = store.getAllKeys();

				request.onsuccess = () => resolve(request.result as string[]);
				request.onerror = () => {
					logError("Failed to get all storage keys:", request.error);
					reject(request.error);
				};
			});
		} catch (error) {
			logError("Failed to get all storage keys:", error);
			return [];
		}
	}

	/**
	 * Clear all storage (for debugging/testing)
	 */
	async clear(): Promise<void> {
		try {
			if (!this.db) return;

			await new Promise<void>((resolve, reject) => {
				const transaction = this.db!.transaction(
					[this.STORE_NAME],
					"readwrite",
				);
				const store = transaction.objectStore(this.STORE_NAME);
				const request = store.clear();

				request.onsuccess = () => {
					logInfo("📦 Cleared all storage");
					resolve();
				};
				request.onerror = () => reject(request.error);
			});
		} catch (error) {
			logError("Failed to clear storage:", error);
			throw error;
		}
	}
}

// Export singleton instance
export const sharedStorageService = SharedStorageService.getInstance();
