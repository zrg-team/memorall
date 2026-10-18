import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	environment: "desktop",
	listening: false,
	initialize: vi.fn(),
	ready: vi.fn(),
	execute: vi.fn(),
}));
vi.mock("@/platform/current", () => ({ platform: runtime }));
vi.mock("@/services", () => ({
	serviceManager: { initialize: runtime.initialize },
}));
vi.mock("@/services/runtime/local-runtime-host", () => ({
	ensureLocalRuntimeProcessor: runtime.ready,
}));
vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: {
		execute: runtime.execute,
		getNotificationBridge: () => ({
			getStatus: () => ({
				subscribedTypes: runtime.listening ? ["JOB_ENQUEUED"] : [],
			}),
		}),
	},
}));

import { memonClient } from "../memon-client";

describe("memon client startup", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		runtime.environment = "desktop";
		runtime.listening = false;
		runtime.execute.mockResolvedValue({
			promise: Promise.resolve({
				status: "completed",
				result: { operation: "machines.list", result: [] },
			}),
		});
	});
	it("waits for local services and job listeners before sending the first request", async () => {
		let release!: () => void;
		runtime.ready.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const result = memonClient.request("machines.list", {});
		await vi.waitFor(() => expect(runtime.ready).toHaveBeenCalledOnce());
		expect(runtime.initialize).toHaveBeenCalledWith({
			proxy: false,
			exposeDatabaseRpc: false,
		});
		expect(runtime.execute).not.toHaveBeenCalled();
		release();
		await expect(result).resolves.toEqual([]);
	});
	it("uses the extension's existing acknowledged bridge without initializing a local processor", async () => {
		runtime.environment = "extension";
		await expect(memonClient.request("machines.list", {})).resolves.toEqual([]);
		expect(runtime.initialize).not.toHaveBeenCalled();
		expect(runtime.ready).not.toHaveBeenCalled();
	});
	it("sends directly when the local processor is already listening", async () => {
		runtime.listening = true;
		await expect(memonClient.request("machines.list", {})).resolves.toEqual([]);
		expect(runtime.initialize).not.toHaveBeenCalled();
		expect(runtime.ready).not.toHaveBeenCalled();
	});
});
