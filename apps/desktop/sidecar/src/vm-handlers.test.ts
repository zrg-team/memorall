import { describe, expect, it, vi } from "vitest";
import { handleVmRequest } from "./vm-handlers";
import type { DesktopVmRuntime } from "./vm-runtime";

describe("desktop VM API", () => {
	it.each([
		"host.exec",
		"tunnel.open",
		"runtime.shutdown",
		"runtime.cancel",
		"../executor.start",
		"constructor",
	])("does not expose internal or host operation %s", async (operation) => {
		const request = vi.fn();
		const vm = { request } as unknown as DesktopVmRuntime;
		await expect(
			handleVmRequest(
				vm,
				"sandbox.request",
				{ operation },
				new AbortController().signal,
			),
		).rejects.toThrow("not allowed");
		expect(request).not.toHaveBeenCalled();
	});
	it("rejects invalid deadlines", async () => {
		await expect(
			handleVmRequest(
				{} as DesktopVmRuntime,
				"sandbox.request",
				{ operation: "health", timeoutMs: Infinity },
				new AbortController().signal,
			),
		).rejects.toThrow("timeout");
	});
});
