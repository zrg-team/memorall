import { logError } from "@/utils/logger";
import { createClient } from "@supabase/supabase-js";
import { platform } from "@/platform/current";

// Supabase configuration
// These can be overridden via environment variables or platform storage.
const getSupabaseConfig = async (): Promise<{
	url: string;
	anonKey: string;
}> => {
	try {
		// Try to get config from the active platform store.
		const [url, anonKey] = await Promise.all([
			platform.persistentStore.get<string>("supabaseUrl"),
			platform.persistentStore.get<string>("supabaseAnonKey"),
		]);

		if (url && anonKey) {
			return {
				url,
				anonKey,
			};
		}
	} catch (error) {
		// Fallback to environment variables or defaults
	}

	// Fallback to environment variables (if available)
	const envUrl =
		import.meta?.env?.EXTENSION_PUBLIC_SUPABASE_URL ||
		import.meta?.env?.VITE_SUPABASE_URL ||
		"";
	const envKey =
		import.meta?.env?.EXTENSION_PUBLIC_SUPABASE_ANON_KEY ||
		import.meta?.env?.VITE_SUPABASE_ANON_KEY ||
		"";

	return {
		url: envUrl,
		anonKey: envKey,
	};
};

// Create Supabase client
let supabaseClient: ReturnType<typeof createClient> | null = null;

export const getSupabaseClient = async () => {
	if (supabaseClient) {
		return supabaseClient;
	}

	const config = await getSupabaseConfig();

	// Only create client if both URL and key are available
	if (!config.url || !config.anonKey) {
		return null;
	}

	supabaseClient = createClient(config.url, config.anonKey, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: false,
			storage: {
				getItem: async (key: string) => {
					try {
						return await platform.persistentStore.get<string>(key);
					} catch {
						return null;
					}
				},
				setItem: async (key: string, value: string) => {
					try {
						await platform.persistentStore.set(key, value);
					} catch {
						// Ignore errors
					}
				},
				removeItem: async (key: string) => {
					try {
						await platform.persistentStore.remove(key);
					} catch {
						// Ignore errors
					}
				},
			},
		},
	});

	return supabaseClient;
};

// Update Supabase configuration
export const updateSupabaseConfig = async (url: string, anonKey: string) => {
	try {
		await Promise.all([
			platform.persistentStore.set("supabaseUrl", url),
			platform.persistentStore.set("supabaseAnonKey", anonKey),
		]);

		// Reset client to force recreation with new config
		supabaseClient = null;
	} catch (error) {
		logError("Failed to update Supabase config:", error);
		throw error;
	}
};

// Clear Supabase configuration
export const clearSupabaseConfig = async () => {
	try {
		await Promise.all([
			platform.persistentStore.remove("supabaseUrl"),
			platform.persistentStore.remove("supabaseAnonKey"),
		]);
		supabaseClient = null;
	} catch (error) {
		logError("Failed to clear Supabase config:", error);
		throw error;
	}
};

// Check if Supabase is configured
export const isSupabaseConfigured = async (): Promise<boolean> => {
	const config = await getSupabaseConfig();
	return Boolean(config.url && config.anonKey);
};
