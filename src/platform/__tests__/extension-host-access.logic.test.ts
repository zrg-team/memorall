import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logWarn: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
}));

import { ExtensionHostAccessPort } from "../extension/extension-host-access";

const COMPOSIO = ["https://backend.composio.dev/*"];

const stubPermissions = (
	permissions: unknown,
): {
	contains: ReturnType<typeof vi.fn>;
	request: ReturnType<typeof vi.fn>;
} => {
	vi.stubGlobal("chrome", { permissions });
	return permissions as never;
};

beforeEach(() => {
	vi.unstubAllGlobals();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ExtensionHostAccessPort", () => {
	it("reports what chrome says about the origins", async () => {
		const permissions = stubPermissions({
			contains: vi.fn().mockResolvedValue(false),
			request: vi.fn(),
		});

		await expect(new ExtensionHostAccessPort().has(COMPOSIO)).resolves.toBe(
			false,
		);
		expect(permissions.contains).toHaveBeenCalledWith({ origins: COMPOSIO });
	});

	it("asks for the origins and passes the answer through", async () => {
		const permissions = stubPermissions({
			contains: vi.fn().mockResolvedValue(false),
			request: vi.fn().mockResolvedValue(true),
		});

		await expect(new ExtensionHostAccessPort().request(COMPOSIO)).resolves.toBe(
			true,
		);
		expect(permissions.request).toHaveBeenCalledWith({ origins: COMPOSIO });
	});

	it("treats a declined prompt — and one Chrome refuses to open — as no grant", async () => {
		stubPermissions({
			contains: vi.fn(),
			// What Chrome throws outside a user gesture.
			request: vi.fn().mockRejectedValue(new Error("must be a user gesture")),
		});

		await expect(new ExtensionHostAccessPort().request(COMPOSIO)).resolves.toBe(
			false,
		);
	});

	// The port gates a request that fails loudly on its own, so an unanswerable
	// check must not be the thing that blocks it.
	it("assumes access where the API is missing or throws", async () => {
		vi.stubGlobal("chrome", undefined);
		await expect(new ExtensionHostAccessPort().has(COMPOSIO)).resolves.toBe(
			true,
		);

		stubPermissions({
			contains: vi.fn().mockRejectedValue(new Error("no such API")),
			request: vi.fn(),
		});
		await expect(new ExtensionHostAccessPort().has(COMPOSIO)).resolves.toBe(
			true,
		);
	});

	it("needs no permission for an empty origin list", async () => {
		const permissions = stubPermissions({
			contains: vi.fn(),
			request: vi.fn(),
		});

		await expect(new ExtensionHostAccessPort().has([])).resolves.toBe(true);
		await expect(new ExtensionHostAccessPort().request([])).resolves.toBe(true);
		expect(permissions.contains).not.toHaveBeenCalled();
		expect(permissions.request).not.toHaveBeenCalled();
	});
});
