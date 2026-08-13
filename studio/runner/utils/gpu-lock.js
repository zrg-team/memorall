const GPU_LOCK_NAME = 'memorall-webgpu-inference';

/**
 * Serialize WebGPU inference across all runners.
 *
 * Both the embedding runner and transformer runner use WebGPU via ONNX Runtime.
 * Running GPU compute kernels from two separate iframe contexts simultaneously
 * causes the WebGPU device instance to be invalidated, crashing inference.
 *
 * This lock ensures only one runner dispatches GPU work at a time.
 * Uses the Web Locks API - atomic, cross-iframe for the same origin
 * (chrome-extension://...), and automatically released if the holder crashes.
 *
 * Falls back to direct execution if the Locks API is unavailable.
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
