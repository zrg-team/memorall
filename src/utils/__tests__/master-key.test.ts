import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseUse, secureValues } = vi.hoisted(() => ({
	databaseUse: vi.fn(),
	secureValues: new Map<string, string>(),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: { use: databaseUse },
	},
}));

vi.mock("../secure-session", () => ({
	default: {
		set: vi.fn(async (key: string, value: string) => {
			secureValues.set(key, value);
		}),
		get: vi.fn(async (key: string) => secureValues.get(key) ?? null),
		exists: vi.fn(async (key: string) => secureValues.has(key)),
	},
}));

vi.mock("../aes", () => ({
	generateStrongPasswordBase64: vi.fn(() => "generated-strong-password"),
	deriveAesKeyFromString: vi.fn(async (secret: string) => `key:${secret}`),
	deriveAesKeyFromCombined: vi.fn(
		async (strongPassword: string, fixedKey: string) =>
			`combined:${strongPassword}:${fixedKey}`,
	),
	encryptStringAes: vi.fn(
		async (data: string, key: string) => `encrypted:${data}:${key}`,
	),
	decryptStringAes: vi.fn(async (data: string) => {
		if (data === "encrypted-master") return "master-strong-password";
		if (data === "legacy-seed") return "legacy-strong-password";
		if (data === "legacy-config") {
			return JSON.stringify({ apiKey: "legacy-key", baseUrl: "legacy-url" });
		}
		if (data === "provider-config") {
			return JSON.stringify({ apiKey: "saved-key", baseUrl: "saved-url" });
		}
		return `decrypted:${data}`;
	}),
}));

import {
	deleteMasterKey,
	decryptWithMasterKey,
	decryptWithMasterPassword,
	detectEncryptionFormat,
	encryptWithMasterKey,
	getEncryptedProviders,
	getLegacyProviders,
	getMasterStrongPassword,
	hasLegacyConfigs,
	hasMasterKey,
	isMasterKeyUnlocked,
	loadProviderConfig,
	lockMasterKey,
	migrateLegacyConfig,
	saveProviderConfig,
	setupMasterKey,
	unlockMasterKey,
} from "../master-key";

const queueDatabaseResults = (...results: unknown[]) => {
	databaseUse.mockImplementation(async () => results.shift());
};

beforeEach(() => {
	secureValues.clear();
	databaseUse.mockReset();
});

describe("master-key database state helpers", () => {
	it("detects master, legacy, and empty encryption formats", async () => {
		queueDatabaseResults([{ key: "master_encryption_key" }]);
		await expect(hasMasterKey()).resolves.toBe(true);

		queueDatabaseResults([]);
		await expect(hasMasterKey()).resolves.toBe(false);

		queueDatabaseResults([], [{ key: "openrouter_config", advancedSeed: "s" }]);
		await expect(hasLegacyConfigs()).resolves.toBe(true);

		queueDatabaseResults(
			[{ key: "openai_config", advancedSeed: "s" }],
			[{ key: "openrouter_config", advancedSeed: null }],
		);
		await expect(getLegacyProviders()).resolves.toEqual(["openai"]);

		queueDatabaseResults([{ key: "master_encryption_key" }]);
		await expect(detectEncryptionFormat()).resolves.toBe("master");

		queueDatabaseResults([], [{ key: "openai_config", advancedSeed: "s" }]);
		await expect(detectEncryptionFormat()).resolves.toBe("legacy");

		queueDatabaseResults([], [], []);
		await expect(detectEncryptionFormat()).resolves.toBe("none");
	});

	it("returns false or empty lists when database checks fail", async () => {
		databaseUse.mockRejectedValue(new Error("db failed"));

		await expect(hasMasterKey()).resolves.toBe(false);
		await expect(hasLegacyConfigs()).resolves.toBe(false);
		await expect(getLegacyProviders()).resolves.toEqual([]);
		await expect(getEncryptedProviders()).resolves.toEqual([]);
	});
});

describe("master-key lifecycle", () => {
	it("sets up and unlocks a master key", async () => {
		await expect(setupMasterKey("short")).rejects.toThrow(
			"Passkey must be at least 6 characters",
		);

		queueDatabaseResults([]);
		await setupMasterKey("long-passkey");

		await expect(getMasterStrongPassword()).resolves.toBe(
			"generated-strong-password",
		);
		await expect(isMasterKeyUnlocked()).resolves.toBe(true);
		expect(databaseUse).toHaveBeenCalledTimes(2);

		secureValues.clear();
		queueDatabaseResults([
			{ key: "master_encryption_key", advancedSeed: "encrypted-master" },
		]);
		await expect(unlockMasterKey("long-passkey")).resolves.toBe(
			"master-strong-password",
		);
		await expect(getMasterStrongPassword()).resolves.toBe(
			"master-strong-password",
		);
	});

	it("rejects missing or corrupted master key records on unlock", async () => {
		queueDatabaseResults([]);
		await expect(unlockMasterKey("passkey")).rejects.toThrow(
			"Master key not found",
		);

		queueDatabaseResults([
			{ key: "master_encryption_key", advancedSeed: null },
		]);
		await expect(unlockMasterKey("passkey")).rejects.toThrow(
			"Master key record is corrupted",
		);
	});

	it("encrypts and decrypts through the unlocked master password", async () => {
		await expect(encryptWithMasterKey("data")).rejects.toThrow(
			"Master key is not unlocked",
		);

		secureValues.set("master_ready", "true");
		secureValues.set("master_strong_password", "strong");

		await expect(encryptWithMasterKey("data")).resolves.toEqual(
			expect.stringContaining("encrypted:data:combined:strong:"),
		);
		await expect(decryptWithMasterKey("provider-config")).resolves.toBe(
			JSON.stringify({ apiKey: "saved-key", baseUrl: "saved-url" }),
		);
		await expect(
			decryptWithMasterPassword("provider-config", "explicit-strong"),
		).resolves.toBe(
			JSON.stringify({ apiKey: "saved-key", baseUrl: "saved-url" }),
		);
	});

	it("locks and deletes the master key", async () => {
		secureValues.set("master_ready", "true");
		secureValues.set("master_strong_password", "strong");

		await lockMasterKey();
		await expect(isMasterKeyUnlocked()).resolves.toBe(true);
		await expect(getMasterStrongPassword()).resolves.toBe("");

		queueDatabaseResults(undefined);
		await deleteMasterKey();
		expect(databaseUse).toHaveBeenCalled();
	});
});

describe("provider config encryption with master key", () => {
	it("saves new and existing provider configs", async () => {
		await expect(
			saveProviderConfig("openai", { apiKey: "key", baseUrl: "url" }),
		).rejects.toThrow("Master key must be unlocked");

		secureValues.set("master_ready", "true");
		secureValues.set("master_strong_password", "strong");

		queueDatabaseResults([]);
		await saveProviderConfig("openai", { apiKey: "key", baseUrl: "url" });
		expect(databaseUse).toHaveBeenCalledTimes(2);

		queueDatabaseResults([{ key: "openai_config" }]);
		await saveProviderConfig("openai", { apiKey: "key", baseUrl: "url" });
		expect(databaseUse).toHaveBeenCalledTimes(4);
	});

	it("loads provider configs and returns null when no config exists", async () => {
		queueDatabaseResults([]);
		await expect(loadProviderConfig("openai")).resolves.toBeNull();

		secureValues.set("master_ready", "true");
		secureValues.set("master_strong_password", "strong");
		queueDatabaseResults([
			{ key: "openai_config", encryptedData: "provider-config" },
		]);

		await expect(loadProviderConfig("openai")).resolves.toEqual({
			apiKey: "saved-key",
			baseUrl: "saved-url",
		});
	});

	it("migrates legacy configs to master-key format", async () => {
		queueDatabaseResults([]);
		await expect(migrateLegacyConfig("openai", "old-passkey")).rejects.toThrow(
			"No openai configuration found",
		);

		queueDatabaseResults([{ key: "openai_config", advancedSeed: null }]);
		await expect(migrateLegacyConfig("openai", "old-passkey")).rejects.toThrow(
			"openai config is not in legacy format",
		);

		secureValues.set("master_ready", "true");
		secureValues.set("master_strong_password", "strong");
		queueDatabaseResults([
			{
				key: "openai_config",
				advancedSeed: "legacy-seed",
				encryptedData: "legacy-config",
			},
		]);

		await migrateLegacyConfig("openai", "old-passkey");
		expect(databaseUse).toHaveBeenCalledTimes(4);
	});

	it("lists providers with encrypted configs", async () => {
		queueDatabaseResults([{ key: "openai_config" }], []);

		await expect(getEncryptedProviders()).resolves.toEqual(["openai"]);
	});
});
