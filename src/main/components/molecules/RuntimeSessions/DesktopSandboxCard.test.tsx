import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	SandboxRuntimePort,
	SandboxRuntimeStatus,
} from "@/platform/contracts/core";
import { DesktopSandboxCard } from "./DesktopSandboxCard";

const service = vi.hoisted(() => ({ health: vi.fn(), dispose: vi.fn() }));
vi.mock("@/services", () => ({
	serviceManager: { getSandboxContainerService: () => service },
}));

const runtimeAt = (
	state: SandboxRuntimeStatus["state"],
	failure: string | null = null,
): SandboxRuntimePort => ({
	status: vi.fn().mockResolvedValue({
		state,
		ready: state === "ready",
		failure,
		initializedAt: null,
	}),
	request: vi.fn(),
	stop: vi.fn(),
});

describe("desktop sandbox status", () => {
	beforeEach(() => vi.clearAllMocks());
	it("shows a status connection failure and offers retry", async () => {
		const runtime = runtimeAt("stopped");
		vi.mocked(runtime.status).mockRejectedValue({
			message: "Sandbox connection failed",
		});
		render(<DesktopSandboxCard runtime={runtime} compact />);
		await screen.findByRole("status", { name: "Sandbox: Error" });
		expect(screen.getByRole("alert").textContent).toContain(
			"Sandbox connection failed",
		);
		expect(
			screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled"),
		).toBe(false);
	});
	it("shows stopped without starting the VM and shows startup details on demand", async () => {
		const runtime = runtimeAt("stopped");
		render(<DesktopSandboxCard runtime={runtime} compact />);
		await screen.findByRole("status", { name: "Sandbox: Stopped" });
		expect(service.health).not.toHaveBeenCalled();
		expect(screen.queryByText(/Additional tools install/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Details" }));
		expect(screen.getByText(/Additional tools install/)).toBeTruthy();
	});
	it("shows startup progress and allows stopping during boot", async () => {
		render(<DesktopSandboxCard runtime={runtimeAt("starting")} compact />);
		await screen.findByRole("status", { name: "Sandbox: Starting…" });
		expect(
			screen
				.getByRole("button", { name: "Stop sandbox" })
				.hasAttribute("disabled"),
		).toBe(false);
		expect(screen.getByText(/first start can take a few minutes/)).toBeTruthy();
	});
	it("shows a readable error and lets the user retry", async () => {
		const runtime = runtimeAt(
			"unavailable",
			"Enable Windows Hypervisor Platform",
		);
		vi.mocked(runtime.request).mockImplementation(async () => {
			vi.mocked(runtime.status).mockResolvedValue({
				state: "ready",
				ready: true,
				failure: null,
				initializedAt: Date.now(),
			});
		});
		render(<DesktopSandboxCard runtime={runtime} compact />);
		await screen.findByRole("status", { name: "Sandbox: Error" });
		expect(screen.getByRole("alert").textContent).toContain(
			"Enable Windows Hypervisor Platform",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(runtime.request).toHaveBeenCalledOnce());
		await screen.findByRole("status", { name: "Sandbox: Ready" });
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
