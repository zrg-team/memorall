import { serviceManager } from "@/services";
import { eq, inArray } from "drizzle-orm";
import { FIXED_ENCRYPTION_KEY } from "@/config/security";
import {
	generateStrongPasswordBase64,
	deriveAesKeyFromString,
	deriveAesKeyFromCombined,
	encryptStringAes,
	decryptStringAes,
} from "@/utils/aes";
import secureSession from "@/utils/secure-session";
import { logInfo, logError } from "@/utils/logger";

// Session keys
const MASTER_READY_KEY = "master_ready";
const MASTER_STRONG_PASSWORD_KEY = "master_strong_password";

// Database key for master encryption
const MASTER_KEY_RECORD = "master_encryption_key";

type AuthProvider = "openai" | "openrouter";
const AUTH_PROVIDERS: AuthProvider[] = ["openai", "openrouter"];

/**
 * Check if master key record exists in database
 */
export async function hasMasterKey(): Promise<boolean> {
	try {
		const result = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.encryption)
				.where(eq(schema.encryption.key, MASTER_KEY_RECORD)),
		);
		return result.length > 0;
	} catch (error) {
		logError("Failed to check master key existence:", error);
		return false;
	}
}

/**
 * Check if any legacy configs exist (configs with advancedSeed per provider)
 */
export async function hasLegacyConfigs(): Promise<boolean> {
	try {
		// Check for configs that have advancedSeed (old format)
		for (const provider of AUTH_PROVIDERS) {
			const configKey = `${provider}_config`;
			const result = await serviceManager.databaseService.use(
				({ db, schema }) =>
					db
						.select()
						.from(schema.encryption)
						.where(eq(schema.encryption.key, configKey)),
			);

			if (result.length > 0 && result[0].advancedSeed) {
				// Has old format with per-provider advancedSeed
				return true;
			}
		}
		return false;
	} catch (error) {
		logError("Failed to check legacy configs:", error);
		return false;
	}
}

/**
 * Get list of legacy providers that need migration
 */
export async function getLegacyProviders(): Promise<AuthProvider[]> {
	const legacyProviders: AuthProvider[] = [];

	try {
		for (const provider of AUTH_PROVIDERS) {
			const configKey = `${provider}_config`;
			const result = await serviceManager.databaseService.use(
				({ db, schema }) =>
					db
						.select()
						.from(schema.encryption)
						.where(eq(schema.encryption.key, configKey)),
			);

			if (result.length > 0 && result[0].advancedSeed) {
				legacyProviders.push(provider);
			}
		}
	} catch (error) {
		logError("Failed to get legacy providers:", error);
	}

	return legacyProviders;
}

/**
 * Detect the encryption format being used
 */
export async function detectEncryptionFormat(): Promise<
	"master" | "legacy" | "none"
> {
	// Check for master key first
	if (await hasMasterKey()) {
		return "master";
	}

	// Check for any legacy configs
	if (await hasLegacyConfigs()) {
		return "legacy";
	}

	return "none";
}

/**
 * Create master key for the first time
 * Generates a strong password and encrypts it with the user's passkey
 */
export async function setupMasterKey(passkey: string): Promise<void> {
	if (passkey.length < 6) {
		throw new Error("Passkey must be at least 6 characters");
	}

	try {
		// Generate master strong password
		const masterStrongPassword = generateStrongPasswordBase64();

		// Encrypt it with user's passkey
		const passkeyDerivedKey = await deriveAesKeyFromString(passkey);
		const encryptedMasterPassword = await encryptStringAes(
			masterStrongPassword,
			passkeyDerivedKey,
		);

		// Store in database
		const existing = await serviceManager.databaseService.use(
			({ db, schema }) =>
				db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, MASTER_KEY_RECORD)),
		);

		if (existing.length > 0) {
			await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.update(schema.encryption)
					.set({
						advancedSeed: encryptedMasterPassword,
						encryptedData: "{}",
						updatedAt: new Date(),
					})
					.where(eq(schema.encryption.key, MASTER_KEY_RECORD)),
			);
		} else {
			await serviceManager.databaseService.use(({ db, schema }) =>
				db.insert(schema.encryption).values({
					key: MASTER_KEY_RECORD,
					advancedSeed: encryptedMasterPassword,
					encryptedData: "{}",
				}),
			);
		}

		// Store in secure session for current session
		await secureSession.set(MASTER_STRONG_PASSWORD_KEY, masterStrongPassword);
		await secureSession.set(MASTER_READY_KEY, "true");

		logInfo("Master key setup complete");
	} catch (error) {
		logError("Failed to setup master key:", error);
		throw error;
	}
}

/**
 * Unlock master key with passkey and store strong password in session
 */
export async function unlockMasterKey(passkey: string): Promise<string> {
	try {
		// Get master key record
		const result = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.encryption)
				.where(eq(schema.encryption.key, MASTER_KEY_RECORD)),
		);

		if (result.length === 0) {
			throw new Error("Master key not found");
		}

		const masterKeyRecord = result[0];
		if (!masterKeyRecord.advancedSeed) {
			throw new Error("Master key record is corrupted");
		}

		// Decrypt master strong password
		const passkeyDerivedKey = await deriveAesKeyFromString(passkey);
		const masterStrongPassword = await decryptStringAes(
			masterKeyRecord.advancedSeed,
			passkeyDerivedKey,
		);

		// Store in secure session
		await secureSession.set(MASTER_STRONG_PASSWORD_KEY, masterStrongPassword);
		await secureSession.set(MASTER_READY_KEY, "true");

		logInfo("Master key unlocked successfully");
		return masterStrongPassword;
	} catch (error) {
		logError("Failed to unlock master key:", error);
		throw error;
	}
}

/**
 * Get the master strong password from session (if unlocked)
 */
export async function getMasterStrongPassword(): Promise<string | null> {
	try {
		if (!(await secureSession.exists(MASTER_READY_KEY))) {
			return null;
		}
		return await secureSession.get(MASTER_STRONG_PASSWORD_KEY);
	} catch (error) {
		logError("Failed to get master strong password:", error);
		return null;
	}
}

/**
 * Check if master key is unlocked in current session
 */
export async function isMasterKeyUnlocked(): Promise<boolean> {
	try {
		return Boolean(await getMasterStrongPassword());
	} catch (error) {
		return false;
	}
}

/**
 * Encrypt data using the master key
 * Requires master key to be unlocked first
 */
export async function encryptWithMasterKey(data: string): Promise<string> {
	const masterStrongPassword = await getMasterStrongPassword();
	if (!masterStrongPassword) {
		throw new Error("Master key is not unlocked");
	}

	const combinedKey = await deriveAesKeyFromCombined(
		masterStrongPassword,
		FIXED_ENCRYPTION_KEY,
	);
	return encryptStringAes(data, combinedKey);
}

/**
 * Decrypt data using the master key
 * Requires master key to be unlocked first
 */
export async function decryptWithMasterKey(
	encryptedData: string,
): Promise<string> {
	const masterStrongPassword = await getMasterStrongPassword();
	if (!masterStrongPassword) {
		throw new Error("Master key is not unlocked");
	}

	const combinedKey = await deriveAesKeyFromCombined(
		masterStrongPassword,
		FIXED_ENCRYPTION_KEY,
	);
	return decryptStringAes(encryptedData, combinedKey);
}

/**
 * Decrypt data using a provided master strong password
 * Used during restoration from master password
 */
export async function decryptWithMasterPassword(
	encryptedData: string,
	masterStrongPassword: string,
): Promise<string> {
	const combinedKey = await deriveAesKeyFromCombined(
		masterStrongPassword,
		FIXED_ENCRYPTION_KEY,
	);
	return decryptStringAes(encryptedData, combinedKey);
}

/**
 * Migrate a legacy provider config to the new master key format
 * Decrypts with old passkey, re-encrypts with master key
 */
export async function migrateLegacyConfig(
	provider: AuthProvider,
	oldPasskey: string,
): Promise<void> {
	const configKey = `${provider}_config`;

	try {
		// 1. Get the legacy encrypted config
		const result = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.encryption)
				.where(eq(schema.encryption.key, configKey)),
		);

		if (result.length === 0) {
			throw new Error(`No ${provider} configuration found`);
		}

		const legacyConfig = result[0];
		if (!legacyConfig.advancedSeed) {
			throw new Error(`${provider} config is not in legacy format`);
		}

		// 2. Decrypt with old passkey
		const oldPasskeyKey = await deriveAesKeyFromString(oldPasskey);
		const strongPassword = await decryptStringAes(
			legacyConfig.advancedSeed,
			oldPasskeyKey,
		);

		// 3. Decrypt the actual config
		const oldCombinedKey = await deriveAesKeyFromCombined(
			strongPassword,
			FIXED_ENCRYPTION_KEY,
		);
		const decryptedConfig = await decryptStringAes(
			legacyConfig.encryptedData,
			oldCombinedKey,
		);

		// 4. Re-encrypt with master key
		const masterStrongPassword = await getMasterStrongPassword();
		if (!masterStrongPassword) {
			throw new Error("Master key must be unlocked before migration");
		}

		const newCombinedKey = await deriveAesKeyFromCombined(
			masterStrongPassword,
			FIXED_ENCRYPTION_KEY,
		);
		const newEncryptedData = await encryptStringAes(
			decryptedConfig,
			newCombinedKey,
		);

		// 5. Update database record - clear advancedSeed (no longer needed)
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.update(schema.encryption)
				.set({
					encryptedData: newEncryptedData,
					advancedSeed: null, // Clear per-provider seed
					updatedAt: new Date(),
				})
				.where(eq(schema.encryption.key, configKey)),
		);

		logInfo(`Successfully migrated ${provider} config to master key format`);
	} catch (error) {
		logError(`Failed to migrate ${provider} config:`, error);
		throw error;
	}
}

/**
 * Adopt an already-decrypted master strong password into this JS context.
 *
 * `secureSession` is an in-memory map scoped to one JS context, so the
 * offscreen document never observes an unlock that happened in the main app —
 * which is why the restore job ships the password across the boundary. Calling
 * this on the receiving side makes `encryptWithMasterKey` / `decryptWithMasterKey`,
 * and therefore every keyed secret, work in that context too.
 */
export async function adoptMasterStrongPassword(
	masterStrongPassword: string,
): Promise<void> {
	await secureSession.set(MASTER_STRONG_PASSWORD_KEY, masterStrongPassword);
	await secureSession.set(MASTER_READY_KEY, "true");
}

// ---------------------------------------------------------------------------
// Keyed secrets
//
// Generic storage for anything that must be encrypted at rest under the single
// master passkey. Provider configs (`openai_config`, `openrouter_config`) are
// one caller; MCP connection credentials (`composio_config`, `mcp_secret_<id>`)
// are another. All of them use the master-key record format — a row in
// `encryptions` with a null `advancedSeed`.
// ---------------------------------------------------------------------------

/** Encrypt and upsert a secret. Requires the master key to be unlocked. */
export async function saveSecret(key: string, value: string): Promise<void> {
	const encryptedData = await encryptWithMasterKey(value);

	const existing = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select({ id: schema.encryption.id })
			.from(schema.encryption)
			.where(eq(schema.encryption.key, key)),
	);

	if (existing.length > 0) {
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.update(schema.encryption)
				.set({
					encryptedData,
					advancedSeed: null,
					updatedAt: new Date(),
				})
				.where(eq(schema.encryption.key, key)),
		);
		return;
	}

	await serviceManager.databaseService.use(({ db, schema }) =>
		db.insert(schema.encryption).values({
			key,
			encryptedData,
			advancedSeed: null,
		}),
	);
}

/** Decrypt a secret, or null when no such record exists. */
export async function loadSecret(key: string): Promise<string | null> {
	const result = await serviceManager.databaseService.use(({ db, schema }) =>
		db.select().from(schema.encryption).where(eq(schema.encryption.key, key)),
	);

	if (result.length === 0) {
		return null;
	}

	return decryptWithMasterKey(result[0].encryptedData);
}

/** Whether a secret record exists, without needing the key unlocked. */
export async function hasSecret(key: string): Promise<boolean> {
	const result = await serviceManager.databaseService.use(({ db, schema }) =>
		db
			.select({ id: schema.encryption.id })
			.from(schema.encryption)
			.where(eq(schema.encryption.key, key)),
	);
	return result.length > 0;
}

export async function deleteSecret(key: string): Promise<void> {
	await serviceManager.databaseService.use(({ db, schema }) =>
		db.delete(schema.encryption).where(eq(schema.encryption.key, key)),
	);
}

/**
 * Save a provider config encrypted with the master key
 */
export async function saveProviderConfig(
	provider: AuthProvider,
	config: { apiKey: string; baseUrl: string },
): Promise<void> {
	try {
		await saveSecret(`${provider}_config`, JSON.stringify(config));
		logInfo(`${provider} configuration saved with master key`);
	} catch (error) {
		logError(`Failed to save ${provider} config:`, error);
		throw error;
	}
}

/**
 * Load a provider config decrypted with the master key
 */
export async function loadProviderConfig(
	provider: AuthProvider,
): Promise<{ apiKey: string; baseUrl: string } | null> {
	try {
		const decryptedData = await loadSecret(`${provider}_config`);
		return decryptedData ? JSON.parse(decryptedData) : null;
	} catch (error) {
		logError(`Failed to load ${provider} config:`, error);
		throw error;
	}
}

/**
 * Get list of all encrypted provider configs
 */
async function findEncryptedProviders(): Promise<AuthProvider[]> {
	const providers: AuthProvider[] = [];

	for (const provider of AUTH_PROVIDERS) {
		const configKey = `${provider}_config`;
		const result = await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.select()
				.from(schema.encryption)
				.where(eq(schema.encryption.key, configKey)),
		);

		if (result.length > 0) {
			providers.push(provider);
		}
	}

	return providers;
}

export async function getEncryptedProviders(): Promise<AuthProvider[]> {
	try {
		return await findEncryptedProviders();
	} catch (error) {
		logError("Failed to get encrypted providers:", error);
		return [];
	}
}

/**
 * Clear master key from session (lock)
 */
export async function lockMasterKey(): Promise<void> {
	try {
		await secureSession.delete(MASTER_READY_KEY);
		await secureSession.delete(MASTER_STRONG_PASSWORD_KEY);
		logInfo("Master key locked");
	} catch (error) {
		logError("Failed to lock master key:", error);
	}
}

/**
 * Delete an unused master key. Provider configs are deliberately preserved.
 */
export async function deleteMasterKey(): Promise<void> {
	try {
		// Delete master key record
		await serviceManager.databaseService.use(({ db, schema }) =>
			db
				.delete(schema.encryption)
				.where(eq(schema.encryption.key, MASTER_KEY_RECORD)),
		);

		// Clear session
		await lockMasterKey();

		logInfo("Master key deleted");
	} catch (error) {
		logError("Failed to delete master key:", error);
		throw error;
	}
}

/**
 * Delete the master key only when no encrypted provider config still depends on it.
 * Returns true when a stale/unused master key was removed.
 */
export async function deleteMasterKeyIfUnused(): Promise<boolean> {
	if (!(await hasMasterKey())) {
		return false;
	}

	if ((await findEncryptedProviders()).length > 0) {
		return false;
	}

	await deleteMasterKey();
	return true;
}

/**
 * Permanently delete the master key and every provider config encrypted by it.
 * This is the recovery path when the user has forgotten the master passkey.
 */
export async function resetMasterKeyAndEncryptedConfigs(): Promise<
	AuthProvider[]
> {
	const encryptedProviders = await findEncryptedProviders();
	const keysToDelete = [
		MASTER_KEY_RECORD,
		...AUTH_PROVIDERS.map((provider) => `${provider}_config`),
	];

	try {
		await serviceManager.databaseService.transaction(({ db, schema }) =>
			db
				.delete(schema.encryption)
				.where(inArray(schema.encryption.key, keysToDelete)),
		);

		await Promise.all([
			lockMasterKey(),
			...AUTH_PROVIDERS.map((provider) =>
				secureSession.delete(`${provider}_ready`),
			),
		]);

		logInfo("Master key and encrypted provider configurations reset");
		return encryptedProviders;
	} catch (error) {
		logError("Failed to reset master key and encrypted configs:", error);
		throw error;
	}
}
