import { beforeEach, describe, expect, it, vi } from "vitest";

const hostAccess = vi.hoisted(() => ({
	has: vi.fn(),
	request: vi.fn(),
}));
const platform = vi.hoisted(
	() => ({ hostAccess }) as { hostAccess?: typeof hostAccess },
);

vi.mock("@/platform/current", () => ({ platform }));

import {
	COMPOSIO_HOST_ORIGINS,
	ensureComposioHostAccess,
	hasComposioHostAccess,
} from "../host-access";

beforeEach(() => {
	platform.hostAccess = hostAccess;
	hostAccess.has.mockReset();
	hostAccess.request.mockReset();
});

describe("Composio host access", () => {
	it("covers the manifest's Composio hosts", () => {
		expect(COMPOSIO_HOST_ORIGINS).toContain("https://backend.composio.dev/*");
	});

	it("does not prompt when the host is already granted", async () => {
		hostAccess.has.mockResolvedValue(true);

		await expect(ensureComposioHostAccess()).resolves.toBe(true);
		expect(hostAccess.request).not.toHaveBeenCalled();
	});

	it("asks for the host when it is withheld", async () => {
		hostAccess.has.mockResolvedValue(false);
		hostAccess.request.mockResolvedValue(true);

		await expect(ensureComposioHostAccess()).resolves.toBe(true);
		expect(hostAccess.request).toHaveBeenCalledWith(COMPOSIO_HOST_ORIGINS);
	});

	it("reports a declined prompt rather than calling anyway", async () => {
		hostAccess.has.mockResolvedValue(false);
		hostAccess.request.mockResolvedValue(false);

		await expect(ensureComposioHostAccess()).resolves.toBe(false);
		await expect(hasComposioHostAccess()).resolves.toBe(false);
	});

	// Desktop and web have no such permission; the gate must not close on them.
	it("stays open on platforms with no host permissions", async () => {
		platform.hostAccess = undefined;

		await expect(hasComposioHostAccess()).resolves.toBe(true);
		await expect(ensureComposioHostAccess()).resolves.toBe(true);
	});
});
