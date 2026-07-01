import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseUse, llmService, sessionReady } = vi.hoisted(() => ({
	databaseUse: vi.fn(),
	llmService: {
		has: vi.fn(),
		remove: vi.fn(),
		create: vi.fn(async () => undefined),
	},
	sessionReady: new Set<string>(),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: { use: databaseUse },
		llmService,
	},
}));

vi.mock("../secure-session", () => ({
	default: {
		set: vi.fn(async (key: string) => {
			sessionReady.add(key);
		}),
		exists: vi.fn(async (key: string) => sessionReady.has(key)),
	},
}));

vi.mock("../aes", () => ({
	deriveAesKeyFromString: vi.fn(async () => "passkey-key"),
	deriveAesKeyFromCombined: vi.fn(async () => "combined-key"),
	decryptStringAes: vi.fn(async (data: string) => {
		if (data === "legacy-seed") return "legacy-strong-password";
		return JSON.stringify({ apiKey: "legacy-key", baseUrl: "legacy-url" });
	}),
}));

vi.mock("../master-key", () => ({
	hasMasterKey: vi.fn(async () => true),
	getMasterStrongPassword: vi.fn(async () => "master-strong-password"),
	decryptWithMasterPassword: vi.fn(async () =>
		JSON.stringify({ apiKey: "master-key", baseUrl: "master-url" }),
	),
	getEncryptedProviders: vi.fn(async () => ["openai", "openrouter"]),
	unlockMasterKey: vi.fn(async () => "master-strong-password"),
}));

import {
	checkAnyProviderNeedsRestore,
	checkProviderNeedsRestore,
	getEncryptedProviders,
	restoreAllProviders,
	restoreAuthProvider,
} from "../auth-provider-restore";
import { unlockAndRestoreProvidersWithPasskey } from "../provider-passkey-unlock";

beforeEach(() => {
	databaseUse.mockReset();
	llmService.has.mockReset();
	llmService.remove.mockReset();
	llmService.create.mockClear();
	sessionReady.clear();
});

describe("auth provider restoration", () => {
	it("restores a master-key provider into the LLM service", async () => {
		databaseUse.mockResolvedValue([
			{ key: "openai_config", encryptedData: "master-config" },
		]);
		llmService.has.mockReturnValueOnce(true);

		await restoreAuthProvider("openai", "passkey");

		expect(llmService.remove).toHaveBeenCalledWith("openai");
		expect(llmService.create).toHaveBeenCalledWith("openai", {
			type: "openai",
			apiKey: "master-key",
			baseURL: "master-url",
		});
		expect(sessionReady.has("openai_ready")).toBe(true);
	});

	it("restores a legacy provider with its per-provider seed", async () => {
		databaseUse.mockResolvedValue([
			{
				key: "openrouter_config",
				advancedSeed: "legacy-seed",
				encryptedData: "legacy-config",
			},
		]);
		llmService.has.mockReturnValueOnce(false);

		await restoreAuthProvider("openrouter", "passkey");

		expect(llmService.remove).not.toHaveBeenCalled();
		expect(llmService.create).toHaveBeenCalledWith("openrouter", {
			type: "openrouter",
			apiKey: "legacy-key",
			baseURL: "legacy-url",
		});
	});

	it("throws when no encrypted provider config exists", async () => {
		databaseUse.mockResolvedValue([]);

		await expect(restoreAuthProvider("openai", "passkey")).rejects.toThrow(
			"No openai configuration found in database",
		);
	});

	it("restores all encrypted providers and continues after one failure", async () => {
		databaseUse
			.mockResolvedValueOnce([{ key: "openai_config", encryptedData: "ok" }])
			.mockResolvedValueOnce([]);

		await expect(restoreAllProviders("master")).resolves.toBeUndefined();
		expect(llmService.create).toHaveBeenCalledTimes(1);
	});

	it("checks whether providers need restoration", async () => {
		llmService.has.mockReturnValueOnce(true);
		sessionReady.add("openai_ready");
		await expect(checkProviderNeedsRestore("openai")).resolves.toBe(false);

		llmService.has.mockReturnValueOnce(false);
		databaseUse.mockResolvedValueOnce([{ key: "openai_config" }]);
		await expect(checkProviderNeedsRestore("openai")).resolves.toBe(true);

		databaseUse.mockRejectedValueOnce(new Error("db failed"));
		await expect(checkProviderNeedsRestore("openai")).resolves.toBe(false);

		llmService.has.mockReturnValue(false);
		databaseUse.mockResolvedValue([{ key: "openai_config" }]);
		await expect(checkAnyProviderNeedsRestore()).resolves.toBe(true);
		await expect(getEncryptedProviders()).resolves.toEqual([
			"openai",
			"openrouter",
		]);
	});

	it("unlocks and restores providers with a passkey", async () => {
		databaseUse.mockResolvedValue([
			{ key: "openai_config", encryptedData: "master-config" },
		]);

		await expect(
			unlockAndRestoreProvidersWithPasskey("passkey"),
		).resolves.toEqual({
			masterStrongPassword: "master-strong-password",
			providers: ["openai", "openrouter"],
		});
	});
});
