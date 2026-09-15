import type { DeviceDownloadSizes } from "@/services/llm/interfaces/base-llm";

export type LocalDevice = "webgpu" | "wasm";

/** Sizes a local model reports: one number, a number per device, or both. */
export interface ModelSizeSource {
	size?: number;
	sizeByDevice?: DeviceDownloadSizes;
}

/**
 * Bytes this browser will download for a model. Runtimes load a different
 * precision per device, so the device's own estimate wins; the single `size`
 * covers runtimes that report one. `null` device (still probing) takes the
 * larger estimate, so a size is never understated while unknown.
 */
export function downloadBytesFor(
	model: ModelSizeSource,
	device: LocalDevice | null,
): number | undefined {
	const perDevice = model.sizeByDevice;
	if (perDevice) {
		const own = device ? perDevice[device] : undefined;
		const largest = Math.max(perDevice.webgpu ?? 0, perDevice.wasm ?? 0);
		const bytes = own ?? (largest || undefined);
		if (bytes) return bytes;
	}
	return model.size && model.size > 0 ? model.size : undefined;
}

/** "86 MB", "1.4 GB"; null for an unknown or empty size. */
export function formatModelSize(bytes: number | undefined): string | null {
	if (!bytes || bytes <= 0 || !Number.isFinite(bytes)) return null;
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	const digits = value >= 10 || unit < 3 ? 0 : 1;
	return `${value.toFixed(digits)} ${units[unit]}`;
}
