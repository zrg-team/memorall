import { describe, expect, it, vi } from "vitest";
import {
	DesktopSandboxRuntimePort,
	decodeVmValue,
	encodeVmValue,
} from "./desktop-sandbox-runtime-port";

describe("desktop sandbox transport", () => {
	it("omits undefined options instead of turning an absent environment into null", async () => {
		const invoke = vi.fn().mockResolvedValue({ completed: true });
		const port = new DesktopSandboxRuntimePort(invoke);
		await port.request("runtime.executeCommand", {
			command: "ls",
			env: undefined,
			commandTimeoutMs: undefined,
			options: { optional: undefined, explicitNull: null },
		});
		expect(invoke).toHaveBeenCalledWith("desktop_sandbox_request", {
			operation: "runtime.executeCommand",
			timeoutMs: 120000,
			payload: { command: "ls", options: { explicitNull: null } },
		});
		expect(encodeVmValue([undefined, null])).toEqual([null, null]);
	});
	it("preserves binary buffers, including subarrays and NUL bytes", () => {
		const input = Uint8Array.from({ length: 20000 }, (_, index) => index % 256);
		const slice = input.subarray(123, 19000);
		const restored = decodeVmValue(encodeVmValue({ buffer: slice })) as {
			buffer: ArrayBuffer;
		};
		expect(new Uint8Array(restored.buffer)).toEqual(slice);
	});
	it("uses only the dedicated native sandbox commands", async () => {
		const invoke = vi.fn().mockResolvedValue({ ready: true });
		const port = new DesktopSandboxRuntimePort(invoke);
		await expect(port.request("health")).resolves.toEqual({ ready: true });
		expect(invoke).toHaveBeenCalledWith("desktop_sandbox_request", {
			operation: "health",
			payload: null,
			timeoutMs: 120000,
		});
		await port.stop();
		expect(invoke).toHaveBeenLastCalledWith("desktop_sandbox_stop", undefined);
	});
	it("normalizes native errors before sandbox and terminal code handle them", async () => {
		const failure = {
			code: "VM_START_FAILED",
			message: "Enable virtualization",
		};
		const port = new DesktopSandboxRuntimePort(
			vi.fn().mockRejectedValue(failure),
		);
		for (const run of [
			() => port.request("health"),
			() => port.status(),
			() => port.stop(),
		]) {
			await expect(run()).rejects.toMatchObject({
				name: "Error",
				message: failure.message,
				code: failure.code,
				cause: failure,
			});
		}
	});
});
