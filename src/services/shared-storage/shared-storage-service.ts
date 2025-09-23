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
 * Shared Storage Service - Handles chrome.storage with proper event notifications
 * Ensures all contexts (background, offscreen, popup) stay in sync
 */
export class SharedStorageService {
	private static instance: SharedStorageService;
	private listeners = new Map<string, Set<StorageChangeListener>>();
	private initialized = false;

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
			// Listen for storage changes from chrome
			if (globalThis.chrome?.storage?.onChanged) {
				chrome.storage.onChanged.addListener((changes, areaName) => {
					if (areaName !== "local") return;

					for (const [key, change] of Object.entries(changes)) {
						this.notifyListeners(key, change.oldValue, change.newValue);
					}
				});
			}

			// Listen for custom storage change messages
			if (globalThis.chrome?.runtime?.onMessage) {
				chrome.runtime.onMessage.addListener((message) => {
					if (message.type === "STORAGE_CHANGED") {
						const { key, oldValue, newValue } = message;
						this.notifyListeners(key, oldValue, newValue);
					}
				});
			}

			this.initialized = true;
			logInfo("📦 SharedStorageService initialized successfully");
		} catch (error) {
			logError("Failed to initialize SharedStorageService:", error);
			throw error;
		}
	}

	/**
	 * Get value from storage
	 */
	async get<T = any>(key: string): Promise<T | null> {
		try {
			if (!globalThis.chrome?.storage?.local) {
				logWarn(`📦 Chrome storage not available for get: ${key}`);
				return null;
			}

			const result = await chrome.storage.local.get([key]);
			const value = result[key] ?? null;

			logInfo(`📦 Storage get: ${key} has value ${value !== null}`);
			return value;
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
			if (!globalThis.chrome?.storage?.local) {
				logWarn(`📦 Chrome storage not available for set: ${key}`);
				return;
			}

			// Get old value for change event
			const oldValue = await this.get(key);

			// Set new value
			await chrome.storage.local.set({ [key]: value });

			logInfo(
				`📦 Storage set: ${key} had old value ${oldValue !== null}, has new value ${value !== null}`,
			);

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
			if (!globalThis.chrome?.storage?.local) {
				logWarn(`📦 Chrome storage not available for remove: ${key}`);
				return;
			}

			// Get old value for change event
			const oldValue = await this.get(key);

			// Remove key
			await chrome.storage.local.remove([key]);

			logInfo(`📦 Storage remove: ${key} had value ${oldValue !== null}`);

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
		return !!globalThis.chrome?.storage?.local;
	}

	/**
	 * Get all keys (for debugging)
	 */
	async getAllKeys(): Promise<string[]> {
		try {
			if (!globalThis.chrome?.storage?.local) return [];

			const result = await chrome.storage.local.get();
			return Object.keys(result);
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
			if (!globalThis.chrome?.storage?.local) return;

			const keys = await this.getAllKeys();
			for (const key of keys) {
				await this.remove(key);
			}

			logInfo("📦 Cleared all storage");
		} catch (error) {
			logError("Failed to clear storage:", error);
			throw error;
		}
	}
}

// Export singleton instance
export const sharedStorageService = SharedStorageService.getInstance();
