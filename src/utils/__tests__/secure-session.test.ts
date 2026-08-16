import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: globalThis,
	});
});

describe("secureSession", () => {
	it("encrypts values in memory and decrypts them on read", async () => {
		const { default: secureSession } = await import("../secure-session");

		await secureSession.set("provider_ready", "true");

		await expect(secureSession.exists("provider_ready")).resolves.toBe(true);
		await expect(secureSession.get("provider_ready")).resolves.toBe("true");
		await expect(secureSession.get("missing")).resolves.toBeNull();
	});

	it("reloads with a fresh session key and empty memory", async () => {
		const { default: secureSession } = await import("../secure-session");

		await secureSession.set("master", "secret");
		await expect(secureSession.get("master")).resolves.toBe("secret");

		await secureSession.reload();

		await expect(secureSession.exists("master")).resolves.toBe(false);
		await expect(secureSession.get("master")).resolves.toBeNull();
	});

	it("deletes individual session values", async () => {
		const { default: secureSession } = await import("../secure-session");

		await secureSession.set("provider_ready", "true");
		await secureSession.delete("provider_ready");

		await expect(secureSession.exists("provider_ready")).resolves.toBe(false);
		await expect(secureSession.get("provider_ready")).resolves.toBeNull();
	});
});
