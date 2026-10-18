import { describe, expect, it, vi } from "vitest";
import type { SandboxRuntimePort } from "@/platform/contracts/core";

const host = vi.hoisted(() => ({
	sandboxRuntime: undefined as SandboxRuntimePort | undefined,
}));
vi.mock("@/platform/current", () => ({ platform: host }));
vi.mock("@/services", () => ({
	serviceManager: {
		getSandboxContainerService: () => ({ prepareWorkspace: async () => {} }),
	},
}));

import { startDesktopSandboxForAgent } from "../agent-sandbox-startup";
import { desktopSandboxController } from "../desktop-sandbox-controller";

describe("agent sandbox automatic startup", () => {
	it("starts an enabled agent's native sandbox without requiring memonOS", async () => {
		const runtime: SandboxRuntimePort = {
			request: vi.fn().mockResolvedValue({}),
			status: vi.fn().mockResolvedValue({
				ready: true,
				state: "ready",
				failure: null,
				initializedAt: null,
			}),
			stop: vi.fn(),
		};
		host.sandboxRuntime = runtime;
		startDesktopSandboxForAgent({
			steps: [{ name: "nodejs-sandbox-feature", enabled: false }],
		});
		expect(runtime.request).not.toHaveBeenCalled();
		startDesktopSandboxForAgent({
			steps: [{ name: "nodejs-sandbox-feature", enabled: true }],
		});
		await desktopSandboxController(runtime).start();
		expect(runtime.request).toHaveBeenCalledExactlyOnceWith(
			"health",
			undefined,
			300000,
		);
	});
	it("does not start a browser sandbox merely by enabling an agent feature", () => {
		host.sandboxRuntime = undefined;
		expect(() =>
			startDesktopSandboxForAgent({
				steps: [{ name: "nodejs-sandbox-feature", enabled: true }],
			}),
		).not.toThrow();
	});
});
