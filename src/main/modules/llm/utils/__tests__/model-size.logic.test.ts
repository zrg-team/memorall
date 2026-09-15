import { describe, expect, it } from "vitest";
import { downloadBytesFor, formatModelSize } from "../model-size";

describe("downloadBytesFor", () => {
	const perDevice = { size: 900, sizeByDevice: { webgpu: 800, wasm: 300 } };

	it("uses the estimate for the device this browser will run on", () => {
		expect(downloadBytesFor(perDevice, "webgpu")).toBe(800);
		expect(downloadBytesFor(perDevice, "wasm")).toBe(300);
	});

	it("never understates while the device is still unknown", () => {
		expect(downloadBytesFor(perDevice, null)).toBe(800);
	});

	it("falls back to the single size a runtime reports", () => {
		expect(downloadBytesFor({ size: 1234 }, "wasm")).toBe(1234);
		expect(downloadBytesFor({ sizeByDevice: {}, size: 50 }, "webgpu")).toBe(50);
		expect(downloadBytesFor({}, "webgpu")).toBeUndefined();
	});
});

describe("formatModelSize", () => {
	it("keeps sizes short and readable", () => {
		expect(formatModelSize(86 * 1024 ** 2)).toBe("86 MB");
		expect(formatModelSize(1.44 * 1024 ** 3)).toBe("1.4 GB");
		expect(formatModelSize(12.3 * 1024 ** 3)).toBe("12 GB");
		expect(formatModelSize(0)).toBeNull();
		expect(formatModelSize(undefined)).toBeNull();
	});
});
