import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import { describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ sandboxRuntime: {} as unknown }));
vi.mock("@/platform/current", () => ({ platform: host }));

import { createMemonTerminalPort } from "../ports";

describe("memonOS terminal availability", () => {
	it("does not boot a native VM before displaying desktop files", async () => {
		const getSandbox = vi.fn(() => new Promise<IAgentSandboxService>(() => {}));
		const port = createMemonTerminalPort(getSandbox);
		await expect(port.availability()).resolves.toEqual({ available: true });
		expect(getSandbox).not.toHaveBeenCalled();
	});
	it("does not restart a stopped VM to poll a previous command", async () => {
		host.sandboxRuntime = {
			status: vi.fn().mockResolvedValue({ ready: false, state: "stopped" }),
		};
		const getSandbox = vi.fn();
		await expect(
			createMemonTerminalPort(getSandbox).read(
				"old-process",
				undefined,
				"pc",
				1000,
			),
		).rejects.toThrow("until the sandbox is ready");
		expect(getSandbox).not.toHaveBeenCalled();
	});
	it("rejects commands during startup without opening a shell session", async () => {
		host.sandboxRuntime = {
			status: vi.fn().mockResolvedValue({ ready: false, state: "starting" }),
		};
		const getSandbox = vi.fn();
		await expect(
			createMemonTerminalPort(getSandbox).run("ls", {
				cwd: "/",
				waitMs: 1000,
				sessionKey: "pc",
			}),
		).rejects.toThrow("until the sandbox is ready");
		expect(getSandbox).not.toHaveBeenCalled();
	});
});
