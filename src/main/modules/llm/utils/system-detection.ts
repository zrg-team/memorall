import type { SystemSpecs } from "../types/system-specs";
import { detectWebGPUAdapter } from "@/utils/webgpu";
import { hasOriginPrivateFileSystem } from "@/platform/core/origin-private-file-system";
import { estimateVRAM as getVRAM } from "./gpu-vram-database";

/**
 * Detects the user's system specifications
 */
export async function detectSystemSpecs(): Promise<SystemSpecs> {
	// Detect memory (approximation based on device memory API)
	const memoryGB = detectMemory();

	// Detect CPU cores
	const cpuCores = navigator.hardwareConcurrency || 4;

	// Detect WebGPU availability
	const hasWebGPU = await detectWebGPUAdapter();

	// Detect where downloaded GGUF weights would be stored
	const hasOpfs = hasOriginPrivateFileSystem();

	// Detect GPU information
	const gpu = await detectGPU();

	// The ceilings the device actually reports, as opposed to the ones inferred
	// from a GPU name.
	const [webgpuMaxAllocationBytes, storageQuotaBytes] = await Promise.all([
		detectWebGPUAllocationLimit(),
		detectStorageQuota(),
	]);

	// Calculate device category
	const deviceCategory = calculateDeviceCategory(
		memoryGB,
		cpuCores,
		hasWebGPU,
		gpu,
	);

	return {
		memoryGB,
		cpuCores,
		hasWebGPU,
		hasOpfs,
		gpu,
		webgpuMaxAllocationBytes,
		storageQuotaBytes,
		deviceCategory,
	};
}

/**
 * The largest single buffer this GPU will hand out.
 *
 * WebGPU withholds VRAM on purpose — it is a fingerprinting vector — so this is
 * the only memory figure the API guarantees. It is also the figure llama.cpp's
 * WebGPU backend treats as free memory, which makes it the number that decides
 * whether a load actually succeeds.
 */
async function detectWebGPUAllocationLimit(): Promise<number | undefined> {
	try {
		const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
		if (!gpu) return undefined;
		const adapter = await gpu.requestAdapter();
		const limit = adapter?.limits?.maxStorageBufferBindingSize;
		return limit ? Number(limit) : undefined;
	} catch {
		return undefined;
	}
}

/** How much the origin may store, which bounds what can be downloaded at all. */
async function detectStorageQuota(): Promise<number | undefined> {
	try {
		const estimate = await navigator.storage?.estimate?.();
		return estimate?.quota ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Detects available memory in GB
 */
function detectMemory(): number {
	// Try to use device memory API if available
	const nav = navigator as Navigator & { deviceMemory?: number };
	if (nav.deviceMemory) {
		return nav.deviceMemory;
	}

	// Fallback: estimate based on other factors
	// Most modern devices have at least 4GB
	return 8; // Conservative default
}

/**
 * Detects GPU information using WebGL
 */
async function detectGPU(): Promise<SystemSpecs["gpu"] | undefined> {
	try {
		const canvas = document.createElement("canvas");
		const gl =
			canvas.getContext("webgl") || canvas.getContext("experimental-webgl");

		if (!gl || !(gl instanceof WebGLRenderingContext)) {
			return undefined;
		}

		const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
		if (!debugInfo) {
			return undefined;
		}

		const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string;
		const renderer = gl.getParameter(
			debugInfo.UNMASKED_RENDERER_WEBGL,
		) as string;

		// Estimate VRAM based on renderer string (very rough estimation)
		const estimatedVRAM = estimateVRAM(renderer);

		return {
			vendor,
			renderer,
			estimatedVRAM,
		};
	} catch {
		return undefined;
	}
}

/**
 * Estimates VRAM based on GPU renderer string
 * Uses comprehensive GPU database
 */
function estimateVRAM(renderer: string): number | undefined {
	// Use the comprehensive GPU database
	return getVRAM(renderer);
}

/**
 * Calculates device category based on specs
 */
function calculateDeviceCategory(
	memoryGB: number,
	cpuCores: number,
	hasWebGPU: boolean,
	gpu: SystemSpecs["gpu"],
): SystemSpecs["deviceCategory"] {
	// Ultra: High-end desktop/laptop with dedicated GPU
	if (
		memoryGB >= 16 &&
		cpuCores >= 8 &&
		hasWebGPU &&
		gpu &&
		(gpu.estimatedVRAM ?? 0) >= 8
	) {
		return "ultra";
	}

	// High: Good desktop/laptop with GPU
	if (memoryGB >= 8 && cpuCores >= 6 && hasWebGPU) {
		return "high";
	}

	// Medium: Average laptop/desktop
	if (memoryGB >= 4 && cpuCores >= 4) {
		return "medium";
	}

	// Low: Entry-level device
	return "low";
}
