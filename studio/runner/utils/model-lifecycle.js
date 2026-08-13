/**
 * ModelLifecycleManager - Reusable model memory management
 *
 * Features:
 * - Auto-unloads model after configurable idle timeout (default: 5 minutes)
 * - Caches model instance in memory
 * - Ensures model is loaded before any operation via withModel()
 * - Thread-safe loading with promise deduplication
 */

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @template T - The model/engine type being managed
 */
export class ModelLifecycleManager {
	/** @type {T | null} */
	#model = null;

	/** @type {string | null} */
	#modelId = null;

	/** @type {number | null} */
	#idleTimer = null;

	/** @type {Promise<T> | null} */
	#loadingPromise = null;

	/** @type {number} */
	#idleTimeoutMs;

	/** @type {((modelId: string, notifyProgress?: Function) => Promise<T>) | null} */
	#loadFn;

	/** @type {((model: T) => Promise<void>) | null} */
	#unloadFn;

	/** @type {string} */
	#name;

	/**
	 * @param {Object} options
	 * @param {string} options.name - Manager name for logging
	 * @param {number} [options.idleTimeoutMs] - Idle timeout before auto-unload (default: 5 min)
	 * @param {(modelId: string, notifyProgress?: Function) => Promise<T>} options.loadFn - Function to load the model
	 * @param {(model: T) => Promise<void>} options.unloadFn - Function to unload/cleanup the model
	 */
	constructor({ name, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, loadFn, unloadFn }) {
		this.#name = name;
		this.#idleTimeoutMs = idleTimeoutMs;
		this.#loadFn = loadFn;
		this.#unloadFn = unloadFn;
	}

	/**
	 * Get the current model instance (may be null if not loaded)
	 * @returns {T | null}
	 */
	get model() {
		return this.#model;
	}

	/**
	 * Get the current model ID
	 * @returns {string | null}
	 */
	get modelId() {
		return this.#modelId;
	}

	/**
	 * Check if a model is currently loaded
	 * @returns {boolean}
	 */
	get isLoaded() {
		return this.#model !== null;
	}

	/**
	 * Check if a model is currently loading
	 * @returns {boolean}
	 */
	get isLoading() {
		return this.#loadingPromise !== null;
	}

	/**
	 * Reset the idle timer - call this on any model activity
	 */
	touch() {
		this.#resetIdleTimer();
	}

	/**
	 * Load a model (or return cached if same model already loaded)
	 * @param {string} modelId - Model identifier to load
	 * @param {Function} [notifyProgress] - Optional progress callback
	 * @returns {Promise<T>}
	 */
	async load(modelId, notifyProgress) {
		// If same model is already loaded, just reset timer and return
		if (this.#model && this.#modelId === modelId) {
			this.#resetIdleTimer();
			return this.#model;
		}

		// If already loading the same model, wait for it
		if (this.#loadingPromise && this.#modelId === modelId) {
			return this.#loadingPromise;
		}

		// If different model is loading, wait for it then unload
		if (this.#loadingPromise) {
			try {
				await this.#loadingPromise;
			} catch {
				// Ignore errors from previous load attempt
			}
		}

		// Unload current model if different
		if (this.#model && this.#modelId !== modelId) {
			await this.unload();
		}

		// Start loading
		this.#modelId = modelId;
		this.#loadingPromise = this.#performLoad(modelId, notifyProgress);

		try {
			this.#model = await this.#loadingPromise;
			this.#resetIdleTimer();
			console.log(`[${this.#name}] model loaded:`, modelId);
			return this.#model;
		} catch (error) {
			this.#model = null;
			this.#modelId = null;
			throw error;
		} finally {
			this.#loadingPromise = null;
		}
	}

	/**
	 * @param {string} modelId
	 * @param {Function} [notifyProgress]
	 * @returns {Promise<T>}
	 */
	async #performLoad(modelId, notifyProgress) {
		if (!this.#loadFn) {
			throw new Error(`[${this.#name}] loadFn not configured`);
		}
		return this.#loadFn(modelId, notifyProgress);
	}

	/**
	 * Unload the current model and clear cache
	 * @returns {Promise<void>}
	 */
	async unload() {
		this.#clearIdleTimer();

		if (this.#loadingPromise) {
			try {
				await this.#loadingPromise;
			} catch {
				// Ignore errors
			}
			this.#loadingPromise = null;
		}

		if (this.#model && this.#unloadFn) {
			try {
				console.log(`[${this.#name}] unloading model:`, this.#modelId);
				await this.#unloadFn(this.#model);
			} catch (error) {
				console.error(`[${this.#name}] unload error:`, error);
			}
		}

		this.#model = null;
		this.#modelId = null;
	}

	/**
	 * Execute an operation that requires the model to be loaded
	 * Automatically loads the model if needed and resets the idle timer
	 *
	 * @template R
	 * @param {string} modelId - Model to ensure is loaded
	 * @param {(model: T) => Promise<R>} operation - Operation to execute with the loaded model
	 * @param {Function} [notifyProgress] - Optional progress callback for loading
	 * @returns {Promise<R>}
	 */
	async withModel(modelId, operation, notifyProgress) {
		const model = await this.load(modelId, notifyProgress);
		this.#resetIdleTimer();

		try {
			return await operation(model);
		} finally {
			// Reset timer after operation completes
			this.#resetIdleTimer();
		}
	}

	/**
	 * Execute an operation that requires any model to be loaded
	 * Uses the currently loaded model or throws if none loaded
	 *
	 * @template R
	 * @param {(model: T) => Promise<R>} operation
	 * @returns {Promise<R>}
	 */
	async withCurrentModel(operation) {
		if (!this.#model) {
			throw new Error(`[${this.#name}] No model loaded`);
		}

		this.#resetIdleTimer();

		try {
			return await operation(this.#model);
		} finally {
			this.#resetIdleTimer();
		}
	}

	#resetIdleTimer() {
		this.#clearIdleTimer();

		if (this.#idleTimeoutMs > 0 && this.#model) {
			this.#idleTimer = setTimeout(() => {
				console.log(`[${this.#name}] idle timeout reached, unloading model:`, this.#modelId);
				this.unload().catch((err) => {
					console.error(`[${this.#name}] auto-unload error:`, err);
				});
			}, this.#idleTimeoutMs);
		}
	}

	#clearIdleTimer() {
		if (this.#idleTimer !== null) {
			clearTimeout(this.#idleTimer);
			this.#idleTimer = null;
		}
	}

	/**
	 * Get current status for debugging/monitoring
	 * @returns {{ isLoaded: boolean, isLoading: boolean, modelId: string | null, idleTimeoutMs: number }}
	 */
	getStatus() {
		return {
			isLoaded: this.isLoaded,
			isLoading: this.isLoading,
			modelId: this.#modelId,
			idleTimeoutMs: this.#idleTimeoutMs,
		};
	}

	/**
	 * Dispose the manager - unloads model and clears timers
	 * @returns {Promise<void>}
	 */
	async dispose() {
		await this.unload();
	}
}
