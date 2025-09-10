import { useState, useEffect } from "react";
import { databaseService } from "@/services/database";
import { schema } from "@/services/database/db";
import { eq } from "drizzle-orm";
import secureSession from "@/utils/secure-session";

export type Provider = "wllama" | "webllm" | "openai" | "lmstudio" | "ollama";

export function useProviderConfig() {
	// OpenAI state (secure-session + DB)
	const [openaiReady, setOpenaiReady] = useState(false);
	const [openaiPasskeyExists, setOpenaiPasskeyExists] = useState(false);
	const [openaiConfigExists, setOpenaiConfigExists] = useState<boolean | null>(
		null,
	);

	// Local provider config existence for Quick Download gating
	const [localConfigExists, setLocalConfigExists] = useState<boolean | null>(
		null,
	);

	// Quick provider selection
	const [quickProvider, setQuickProvider] = useState<Provider>("wllama");

	useEffect(() => {
		(async () => {
			try {
				setOpenaiReady(await secureSession.exists("openai_ready"));
			} catch (_) {
				setOpenaiReady(false);
			}
			try {
				setOpenaiPasskeyExists(await secureSession.exists("openai_passkey"));
			} catch (_) {
				setOpenaiPasskeyExists(false);
			}
			try {
				const row = (
					await databaseService.use(({ db }) =>
						db
							.select()
							.from(schema.encryption)
							.where(eq(schema.encryption.key, "openai_config")),
					)
				)[0];
				setOpenaiConfigExists(!!row);
			} catch (_) {
				setOpenaiConfigExists(false);
			}
		})();
	}, []);

	// Check local provider configuration when selected in Quick Download
	useEffect(() => {
		const run = async () => {
			if (quickProvider !== "lmstudio" && quickProvider !== "ollama") {
				setLocalConfigExists(null);
				return;
			}
			const key =
				quickProvider === "lmstudio" ? "lmstudio_config" : "ollama_config";
			try {
				const row = (
					await databaseService.use(({ db }) =>
						db
							.select()
							.from(schema.configurations)
							.where(eq(schema.configurations.key, key)),
					)
				)[0];
				setLocalConfigExists(!!row);
			} catch {
				setLocalConfigExists(false);
			}
		};
		run();
	}, [quickProvider]);

	return {
		openaiReady,
		setOpenaiReady,
		openaiPasskeyExists,
		setOpenaiPasskeyExists,
		openaiConfigExists,
		setOpenaiConfigExists,
		localConfigExists,
		setLocalConfigExists,
		quickProvider,
		setQuickProvider,
	};
}
