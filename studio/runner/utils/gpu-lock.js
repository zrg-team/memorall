const GPU_LOCK_NAME = 'memorall-webgpu-inference';

/**
 * Serialize WebGPU work across all runners.
 *
 * The embedding, transformer, wllama and webllm runners each live in their own
 * iframe and each open their own WebGPU device. Touching the GPU from two of
 * those contexts at once invalidates the device instance and crashes whatever
 * is mid-flight with "A valid external Instance reference no longer exists".
 *
 * Every path that talks to the GPU has to hold this lock - not just inference.
 * Releasing a session (dispose/exit) tears GPU resources down, and the model
 * lifecycle managers do that from an *idle timer*, so an unlocked dispose lands
 * in the middle of another runner's generation.
 *
 * Uses the Web Locks API - atomic, cross-iframe for the same origin
 * (chrome-extension://...), and automatically released if the holder crashes.
 *
 * Falls back to direct execution if the Locks API is unavailable.
 *
 * The lock is NOT reentrant: never call this from inside another holder.
 *
 * @param {() => Promise<any>} fn - The GPU work to run exclusively
 * @returns {Promise<any>}
 */
export async function withGPULock(fn) {
	if (typeof navigator === 'undefined' || !navigator.locks) {
		return fn();
	}
	return navigator.locks.request(GPU_LOCK_NAME, fn);
}

/**
 * Take the GPU lock only when the work actually touches the GPU, so CPU-only
 * runners (wasm inference, wasm embeddings) are not queued behind it.
 *
 * @param {boolean} usesGPU
 * @param {() => Promise<any>} fn
 * @returns {Promise<any>}
 */
export async function withOptionalGPULock(usesGPU, fn) {
	return usesGPU ? withGPULock(fn) : fn();
}
