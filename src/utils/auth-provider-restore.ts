import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import { FIXED_ENCRYPTION_KEY } from "@/config/security";
import {
	deriveAesKeyFromString,
	deriveAesKeyFromCombined,
	decryptStringAes,
} from "@/utils/aes";
import secureSession from "@/utils/secure-session";
import { logInfo, logError } from "@/utils/logger";
import {
	adoptMasterStrongPassword,
	hasMasterKey,
	getMasterStrongPassword,
	decryptWithMasterPassword,
	getEncryptedProviders as getMasterEncryptedProviders,
} from "@/utils/master-key";

type AuthProvider = "openai" | "openrouter";

/**
 * Restore all encrypted providers at once using master key
 * This is the preferred method when master key is unlocked
 */
export async function restoreAllProviders(
	masterStrongPassword: string,
): Promise<void> {
	// Both the main app and the offscreen document funnel through here, and
	// `secureSession` is per-context — so this is the one place that can make the
	// unlocked master key observable wherever the restore ran. Without it, code
	// in the offscreen worker (MCP connection secrets, for instance) cannot
	// decrypt anything even though the user has unlocked.
	await adoptMasterStrongPassword(masterStrongPassword);

	const providers = await getMasterEncryptedProviders();

	for (const provider of providers) {
		try {
			await restoreProviderWithMasterPassword(provider, masterStrongPassword);
			logInfo(`✅ ${provider} service restored`);
		} catch (error) {
			logError(`Failed to restore ${provider}:`, error);
			// Continue with other providers
		}
	}
}

/**
 * Restore a single provider using master strong password
 */
async function restoreProviderWithMasterPassword(
	provider: AuthProvider,
	masterStrongPassword: string,
): Promise<void> {
	const configKey = `${provider}_config`;
	const readyKey = `${provider}_ready`;

	try {
		// 1. Fetch encrypted config from database
		const encryptedConfig = (
			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, configKey));
			})
		)[0];

		if (!encryptedConfig) {
			throw new Error(`No ${provider} configuration found in database`);
		}

		// 2. Decrypt config using master key
		const decryptedData = await decryptWithMasterPassword(
			encryptedConfig.encryptedData,
			masterStrongPassword,
		);
		const config = JSON.parse(decryptedData);

		// 3. Create service in LLM service manager
		if (serviceManager.llmService.has(provider)) {
			serviceManager.llmService.remove(provider);
		}

		await serviceManager.llmService.create(provider, {
			type: provider,
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});

		// 4. Mark as ready in secure session
		await secureSession.set(readyKey, "true");
	} catch (error) {
		logError(`Failed to restore ${provider} service:`, error);
		throw error;
	}
}

/**
 * Decrypt and restore an authentication provider
 * Supports both master key format and legacy format
 */
export async function restoreAuthProvider(
	provider: AuthProvider,
	passkey: string,
): Promise<void> {
	const configKey = `${provider}_config`;
	const readyKey = `${provider}_ready`;

	try {
		// 1. Fetch encrypted config from database
		const encryptedConfig = (
			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, configKey));
			})
		)[0];

		if (!encryptedConfig) {
			throw new Error(`No ${provider} configuration found in database`);
		}

		let config: { apiKey: string; baseUrl: string };

		// Check if this is master key format (no advancedSeed) or legacy format
		if (encryptedConfig.advancedSeed) {
			// Legacy format: decrypt using per-provider passkey
			const passkeyKey = await deriveAesKeyFromString(passkey);
			const strongPassword = await decryptStringAes(
				encryptedConfig.advancedSeed,
				passkeyKey,
			);

			const combinedKey = await deriveAesKeyFromCombined(
				strongPassword,
				FIXED_ENCRYPTION_KEY,
			);
			const decryptedData = await decryptStringAes(
				encryptedConfig.encryptedData,
				combinedKey,
			);
			config = JSON.parse(decryptedData);
		} else {
			// Master key format: passkey is actually the master passkey
			// First unlock the master key, then decrypt config
			const masterStrongPassword = await getMasterStrongPassword();
			if (!masterStrongPassword) {
				throw new Error("Master key is not unlocked");
			}

			const decryptedData = await decryptWithMasterPassword(
				encryptedConfig.encryptedData,
				masterStrongPassword,
			);
			config = JSON.parse(decryptedData);
		}

		// 3. Create service in LLM service manager
		if (serviceManager.llmService.has(provider)) {
			serviceManager.llmService.remove(provider);
		}

		await serviceManager.llmService.create(provider, {
			type: provider,
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});

		// 4. Mark as ready in secure session
		await secureSession.set(readyKey, "true");

		logInfo(`✅ ${provider} service restored successfully`);
	} catch (error) {
		logError(`Failed to restore ${provider} service:`, error);
		throw error;
	}
}

/**
 * Check if any provider needs restoration
 */
export async function checkAnyProviderNeedsRestore(): Promise<boolean> {
	const providers = await getMasterEncryptedProviders();

	for (const provider of providers) {
		if (await checkProviderNeedsRestore(provider)) {
			return true;
		}
	}

	return false;
}

/**
 * Get list of all encrypted provider configs
 */
export async function getEncryptedProviders(): Promise<AuthProvider[]> {
	return getMasterEncryptedProviders();
}

/**
 * Check if a provider needs restoration (has config but not loaded)
 */
export async function checkProviderNeedsRestore(
	provider: AuthProvider,
): Promise<boolean> {
	const configKey = `${provider}_config`;
	const readyKey = `${provider}_ready`;

	try {
		// Check if service is already loaded in memory and ready
		if (
			serviceManager.llmService.has(provider) &&
			(await secureSession.exists(readyKey))
		) {
			return false; // Already restored
		}

		// Check if config exists in database
		const encryptedConfig = (
			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, configKey));
			})
		)[0];

		return !!encryptedConfig; // Needs restore if config exists but not loaded
	} catch (error) {
		logError(`Failed to check if ${provider} needs restore:`, error);
		return false;
	}
}
