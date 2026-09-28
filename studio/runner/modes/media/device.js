// Device selection for media models.
import { withOptionalGPULock } from "../../utils/gpu-lock.js";

let probePromise = null;

/** @returns {Promise<{ available: boolean, supportsF16: boolean }>} */
export function probeWebGPU() {
	if (!probePromise) {
		probePromise = (async () => {
			try {
				const gpu =
					typeof navigator !== "undefined" ? navigator.gpu : undefined;
				const adapter = await gpu?.requestAdapter?.({
					powerPreference: "high-performance",
				});
				if (!adapter) return { available: false, supportsF16: false };
				return {
					available: true,
					supportsF16: Boolean(adapter.features?.has?.("shader-f16")),
				};
			} catch {
				return { available: false, supportsF16: false };
			}
		})();
	}
	return probePromise;
}

/** Test hook: forget the memoised adapter probe. */
export function resetWebGPUProbe() {
	probePromise = null;
}

/**
 * @param {"webgpu" | "wasm" | "auto" | undefined} requested
 * @param {boolean} webgpuAvailable
 * @returns {"webgpu" | "wasm"}
 */
export function chooseDevice(requested, webgpuAvailable) {
	if (requested === "wasm") return "wasm";
	if (requested === "webgpu") {
		if (!webgpuAvailable) {
			throw new Error(
				"This model needs WebGPU, but no WebGPU adapter is available in this browser.",
			);
		}
		return "webgpu";
	}
	return webgpuAvailable ? "webgpu" : "wasm";
}

function adaptSingleDtype(dtype, device, supportsF16) {
	if (typeof dtype !== "string") return dtype;
	const halfUnsupported = device !== "webgpu" || !supportsF16;
	if (dtype === "q4f16" && halfUnsupported) return "q4";
	// WASM runs fp16 weights, but slowly and only after upcasting; a GPU without
	// shader-f16 cannot run them at all.
	if (dtype === "fp16" && device === "webgpu" && !supportsF16) return "fp32";
	return dtype;
}

/**
 * Downgrades half-precision dtypes the target cannot run.
 * @param {string | Record<string, string> | undefined} dtype
 */
export function adaptDtype(dtype, device, supportsF16) {
	if (!dtype || typeof dtype === "string") {
		return adaptSingleDtype(dtype, device, supportsF16);
	}
	return Object.fromEntries(
		Object.entries(dtype).map(([module, value]) => [
			module,
			adaptSingleDtype(value, device, supportsF16),
		]),
	);
}

export function dtypeLabel(dtype) {
	if (!dtype) return "auto";
	if (typeof dtype === "string") return dtype;
	return Object.entries(dtype)
		.map(([module, value]) => `${module}:${value}`)
		.join(",");
}

/** Holds the cross-runner GPU lock while `fn` touches a WebGPU session. */
export function runOnDevice(device, fn) {
	return withOptionalGPULock(device === "webgpu", fn);
}
