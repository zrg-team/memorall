import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	SandboxRuntimePort,
	SandboxRuntimeStatus,
} from "@/platform/contracts/core";
import {
	DesktopSandboxController,
	desktopSandboxLabel,
} from "../desktop-sandbox-controller";

const workspace = vi.hoisted(() => ({
	prepareWorkspace: vi.fn(),
	dispose: vi.fn(),
}));
vi.mock("@/services", () => ({
	serviceManager: { getSandboxContainerService: () => workspace },
}));

const status = (
	state: SandboxRuntimeStatus["state"],
): SandboxRuntimeStatus => ({
	state,
	ready: state === "ready",
	failure: null,
	initializedAt: null,
});
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};

describe("desktop sandbox lifecycle", () => {
	beforeEach(() => {
		workspace.prepareWorkspace.mockReset().mockResolvedValue(undefined);
		workspace.dispose.mockReset().mockResolvedValue(undefined);
	});
	it("keeps Terminal blocked until the saved workspace has finished restoring", async () => {
		const files = deferred<void>();
		workspace.prepareWorkspace.mockReturnValue(files.promise);
		const runtime: SandboxRuntimePort = {
			status: vi.fn().mockResolvedValue(status("ready")),
			request: vi.fn().mockResolvedValue({}),
			stop: vi.fn(),
		};
		const controller = new DesktopSandboxController(runtime);
		const starting = controller.start();
		await vi.waitFor(() =>
			expect(workspace.prepareWorkspace).toHaveBeenCalledOnce(),
		);
		await controller.refresh();
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Starting…");
		files.resolve();
		await starting;
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Ready");
		await controller.start();
		expect(workspace.prepareWorkspace).toHaveBeenCalledOnce();
	});
	it("starts once, publishes immediately, and can cancel boot then restart", async () => {
		const boot = deferred<void>();
		let current = status("stopped");
		const runtime: SandboxRuntimePort = {
			status: vi.fn(async () => current),
			request: vi
				.fn()
				.mockImplementationOnce(() => {
					current = status("starting");
					return boot.promise;
				})
				.mockImplementationOnce(async () => {
					current = status("ready");
				}),
			stop: vi.fn(async () => {
				current = status("stopped");
				boot.reject(new Error("Startup cancelled"));
			}),
		};
		const controller = new DesktopSandboxController(runtime);
		const starting = controller.start();
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Starting…");
		expect(controller.start()).toBe(starting);
		await Promise.resolve();
		expect(runtime.request).toHaveBeenCalledOnce();
		await controller.stop();
		await starting;
		expect(runtime.stop).toHaveBeenCalledOnce();
		expect(controller.getSnapshot()).toMatchObject({
			action: null,
			error: null,
			status: { state: "stopped" },
		});
		await controller.refresh();
		expect(runtime.request).toHaveBeenCalledOnce();
		await controller.start({ automatic: true });
		expect(runtime.request).toHaveBeenCalledOnce();
		await controller.start();
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Ready");
	});
	it("can stop during file restoration and leaves the service stopped", async () => {
		const files = deferred<void>();
		workspace.prepareWorkspace.mockReturnValue(files.promise);
		let current = status("ready");
		const runtime: SandboxRuntimePort = {
			status: vi.fn(async () => current),
			request: vi.fn().mockResolvedValue({}),
			stop: vi.fn(async () => {
				current = status("stopped");
				files.reject(new Error("Cancelled"));
			}),
		};
		const controller = new DesktopSandboxController(runtime);
		const starting = controller.start();
		await vi.waitFor(() =>
			expect(workspace.prepareWorkspace).toHaveBeenCalledOnce(),
		);
		await controller.stop();
		await starting;
		expect(workspace.dispose).toHaveBeenCalledOnce();
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Stopped");
		await controller.start({ automatic: true });
		expect(runtime.request).toHaveBeenCalledOnce();
	});
	it("retains workspace restoration failures even when the VM itself is ready", async () => {
		workspace.prepareWorkspace.mockRejectedValueOnce(
			new Error("Storage is full"),
		);
		const runtime: SandboxRuntimePort = {
			status: vi.fn().mockResolvedValue(status("ready")),
			request: vi.fn().mockResolvedValue({}),
			stop: vi.fn(),
		};
		const controller = new DesktopSandboxController(runtime);
		await controller.start();
		await controller.refresh();
		expect(controller.getSnapshot().error).toBe("Storage is full");
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Error");
		await controller.start();
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Ready");
	});
	it("ignores a status reply from before a new start and retains actionable startup errors", async () => {
		const oldStatus = deferred<SandboxRuntimeStatus>();
		const boot = deferred<void>();
		const runtime: SandboxRuntimePort = {
			status: vi
				.fn()
				.mockReturnValueOnce(oldStatus.promise)
				.mockResolvedValue(status("stopped")),
			request: vi.fn().mockReturnValue(boot.promise),
			stop: vi.fn(),
		};
		const controller = new DesktopSandboxController(runtime);
		const polling = controller.refresh();
		const starting = controller.start();
		oldStatus.resolve(status("ready"));
		await polling;
		expect(controller.getSnapshot().status).toBeNull();
		boot.reject(new Error("Enable hardware virtualization"));
		await starting;
		await controller.refresh();
		expect(controller.getSnapshot().error).toBe(
			"Enable hardware virtualization",
		);
		expect(desktopSandboxLabel(controller.getSnapshot())).toBe("Error");
	});
});
