import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Arming the co-agent is what actually gives the model tools that can click and
 * type, so it has to be deliberate: attaching succeeds or the agent stays off,
 * and turning it off takes effect immediately without needing the platform.
 */

const request = vi.fn();
const capabilityGet = vi.fn(() => ({ available: true }));

vi.mock("@/platform/current", () => ({
	platform: {
		browserCommands: { request: (value: unknown) => request(value) },
		capabilities: { get: () => capabilityGet() },
	},
}));

const load = async () => {
	const module = await import("@/main/stores/co-agent-activation");
	module.useCoAgentActivationStore.setState({
		isActive: false,
		available: null,
		error: null,
		isActivating: false,
		pendingUrl: null,
	});
	return module.useCoAgentActivationStore;
};

const ok = {
	source: "memorall:co-agent-browser-command",
	command: "activate",
	success: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	capabilityGet.mockReturnValue({ available: true });
});

describe("co-agent activation", () => {
	it("arms the agent once it has attached to something", async () => {
		request.mockResolvedValue(ok);
		const store = await load();

		await expect(store.getState().activate()).resolves.toBe(true);
		expect(store.getState().isActive).toBe(true);
	});

	it("stays off when there is nothing to attach to", async () => {
		request.mockResolvedValue({
			source: "memorall:co-agent-browser-command",
			command: "activate",
			success: false,
			error: "Open a page in the managed browser first.",
		});
		const store = await load();

		await expect(store.getState().activate()).resolves.toBe(false);
		// Otherwise the model would be handed tools that cannot reach anything.
		expect(store.getState().isActive).toBe(false);
		expect(store.getState().error).toMatch(/managed browser/i);
	});

	it("disarms without asking the platform", async () => {
		request.mockResolvedValue(ok);
		const store = await load();
		await store.getState().activate();
		request.mockClear();

		store.getState().setActive(false);

		expect(store.getState().isActive).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});

	it("passes a URL through so a link opens in the managed browser", async () => {
		request.mockResolvedValue(ok);
		const store = await load();

		await store.getState().activate("https://example.test");

		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "activate",
				url: "https://example.test",
			}),
		);
	});

	it("reports availability from the platform capability", async () => {
		capabilityGet.mockReturnValue({ available: false });
		const store = await load();

		store.getState().resolveAvailability();
		await vi.waitFor(() => expect(store.getState().available).toBe(false));
	});
});
