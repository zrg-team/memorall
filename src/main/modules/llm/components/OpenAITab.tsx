import { eq } from "drizzle-orm";
import {
	AlertCircle,
	CheckCircle,
	Eye,
	EyeOff,
	Loader2,
	Shield,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterKeySetupDialog } from "@/main/components/molecules/MasterKeySetupDialog";
import { PasskeyPromptDialog } from "@/main/components/molecules/PasskeyPromptDialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { serviceManager } from "@/services";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { logError, logInfo } from "@/utils/logger";
import {
	deleteMasterKeyIfUnused,
	getEncryptedProviders,
	getMasterStrongPassword,
	hasMasterKey,
	isMasterKeyUnlocked,
	loadProviderConfig,
	resetMasterKeyAndEncryptedConfigs,
	saveProviderConfig,
	setupMasterKey,
	unlockMasterKey,
} from "@/utils/master-key";
import secureSession from "@/utils/secure-session";

interface OpenAITabProps {
	onModelLoaded?: (modelId: string, provider: "openai") => void;
}

export const OpenAITab: React.FC<OpenAITabProps> = ({ onModelLoaded }) => {
	const { t } = useTranslation("llm");
	// Component state
	const [configState, setConfigState] = useState<
		"loading" | "no-config" | "has-config" | "loaded"
	>("loading");
	const [configDate, setConfigDate] = useState<Date | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	// Form states for new configuration
	const [tempApiKey, setTempApiKey] = useState("");
	const [tempBaseUrl, setTempBaseUrl] = useState("https://api.openai.com/v1");
	const [showApiKey, setShowApiKey] = useState(false);

	// Master key setup dialog
	const [showMasterKeySetup, setShowMasterKeySetup] = useState(false);
	const [showMasterKeyUnlock, setShowMasterKeyUnlock] = useState(false);
	const [unlockProviders, setUnlockProviders] = useState<
		("openai" | "openrouter")[]
	>([]);
	const [pendingSaveConfig, setPendingSaveConfig] = useState<{
		apiKey: string;
		baseUrl: string;
	} | null>(null);

	// Check state on mount: DB -> memory -> ready
	useEffect(() => {
		checkOpenAIState();
	}, []);

	const checkOpenAIState = async () => {
		setConfigState("loading");
		try {
			// Check if already loaded in memory
			if (
				serviceManager.llmService.has("openai") &&
				(await secureSession.exists("openai_ready"))
			) {
				setConfigState("loaded");
				return;
			}

			// Check if config exists in database
			const encryptedConfig = (
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.select()
						.from(schema.encryption)
						.where(eq(schema.encryption.key, "openai_config"));
				})
			)[0];

			if (encryptedConfig) {
				setConfigState("has-config");
				setConfigDate(encryptedConfig.createdAt);
			} else {
				setConfigState("no-config");
			}
		} catch (error) {
			logError("Failed to check OpenAI state:", error);
			setConfigState("no-config");
		}
	};

	const saveAndActivateConfig = async (config: {
		apiKey: string;
		baseUrl: string;
	}) => {
		await saveProviderConfig("openai", config);

		await serviceManager.llmService.create("openai", {
			type: "openai",
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});

		await secureSession.set("openai_ready", "true");

		const masterStrongPassword = await getMasterStrongPassword();
		if (masterStrongPassword) {
			await backgroundJob.execute(
				"restore-all-providers",
				{ masterStrongPassword },
				{ stream: false },
			);
		}

		setTempApiKey("");
		setConfigState("loaded");
		logInfo("OpenAI configuration saved successfully");
		onModelLoaded?.("gpt-4o", "openai");
	};

	// Save new configuration to database
	const handleSaveConfig = async () => {
		if (!tempApiKey.trim()) {
			setError(t("openai.fillAllRequiredFields"));
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			const config = {
				apiKey: tempApiKey.trim(),
				baseUrl: tempBaseUrl.trim(),
			};

			// Check if master key exists
			const masterKeyExists = await hasMasterKey();

			const removedUnusedMasterKey =
				masterKeyExists && (await deleteMasterKeyIfUnused());
			if (!masterKeyExists || removedUnusedMasterKey) {
				// Need to setup master key first
				setPendingSaveConfig(config);
				setShowMasterKeySetup(true);
				setIsLoading(false);
				return;
			}

			// Check if master key is unlocked
			const isUnlocked = await isMasterKeyUnlocked();
			if (!isUnlocked) {
				setUnlockProviders(await getEncryptedProviders());
				setPendingSaveConfig(config);
				setShowMasterKeyUnlock(true);
				setIsLoading(false);
				return;
			}

			await saveAndActivateConfig(config);
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			setError(t("openai.failedToSaveConfiguration", { error: msg }));
			logError("Failed to save config:", error);
		} finally {
			setIsLoading(false);
		}
	};

	// Handle master key setup completion
	const handleMasterKeySetupComplete = async (passkey: string) => {
		await setupMasterKey(passkey);

		// Now save the pending config
		if (pendingSaveConfig) {
			await saveAndActivateConfig(pendingSaveConfig);
		}

		setShowMasterKeySetup(false);
		setPendingSaveConfig(null);
	};

	const handleMasterKeyUnlockComplete = async (passkey: string) => {
		await unlockMasterKey(passkey);

		if (pendingSaveConfig) {
			await saveAndActivateConfig(pendingSaveConfig);
		}

		setShowMasterKeyUnlock(false);
		setPendingSaveConfig(null);
	};

	const handleForgotMasterPasskey = async () => {
		const deletedProviders = await resetMasterKeyAndEncryptedConfigs();
		const currentModel = await serviceManager.llmService.getCurrentModel();
		if (
			currentModel &&
			deletedProviders.includes(
				currentModel.provider as "openai" | "openrouter",
			)
		) {
			await serviceManager.llmService.clearCurrentModel();
		}

		for (const provider of deletedProviders) {
			if (serviceManager.llmService.has(provider)) {
				serviceManager.llmService.remove(provider);
			}
			try {
				await backgroundJob.execute(
					"remove-auth-provider",
					{ provider },
					{ stream: false },
				);
			} catch (error) {
				logError(
					`Failed to remove ${provider} from background services:`,
					error,
				);
			}
		}

		setUnlockProviders([]);
		setShowMasterKeyUnlock(false);
		setShowMasterKeySetup(true);
	};

	// Load configuration (auto-load if master key is unlocked)
	const handleLoadConfig = async () => {
		setIsLoading(true);
		setError("");

		try {
			// Check if master key is unlocked
			const isUnlocked = await isMasterKeyUnlocked();
			if (!isUnlocked) {
				setError(t("openai.masterKeyNotUnlocked"));
				setIsLoading(false);
				return;
			}

			// Load config
			const config = await loadProviderConfig("openai");
			if (!config) {
				setError(t("openai.noConfigurationFoundError"));
				setIsLoading(false);
				return;
			}

			// Create OpenAI service
			await serviceManager.llmService.create("openai", {
				type: "openai",
				apiKey: config.apiKey,
				baseURL: config.baseUrl,
			});

			// Mark as ready
			await secureSession.set("openai_ready", "true");

			// Also restore in offscreen thread via background job
			const masterStrongPassword = await getMasterStrongPassword();
			if (masterStrongPassword) {
				await backgroundJob.execute(
					"restore-all-providers",
					{ masterStrongPassword },
					{ stream: false },
				);
			}

			setConfigState("loaded");
			logInfo("OpenAI configuration loaded successfully");

			onModelLoaded?.("gpt-4o", "openai");
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			setError(t("openai.failedToLoadConfiguration", { error: msg }));
			logError("Failed to load config:", error);
		} finally {
			setIsLoading(false);
		}
	};

	// Delete configuration from database
	const handleDeleteConfig = async () => {
		if (!confirm(t("openai.deleteConfigurationConfirm"))) {
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			// Check if current model is using openai provider
			const currentModel = await serviceManager.llmService.getCurrentModel();
			if (currentModel && currentModel.provider === "openai") {
				await serviceManager.llmService.clearCurrentModel();
				logInfo("Cleared current model as it was using openai provider");
			}

			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.delete(schema.encryption)
					.where(eq(schema.encryption.key, "openai_config"));
			});

			// Clear memory and remove the master key if no config still uses it.
			await secureSession.delete("openai_ready");
			await deleteMasterKeyIfUnused();

			// Remove LLM service
			if (serviceManager.llmService.has("openai")) {
				serviceManager.llmService.remove("openai");
				logInfo("Removed openai LLM service");
			}

			// Also remove from offscreen thread via background job
			await backgroundJob.execute(
				"remove-auth-provider",
				{ provider: "openai" },
				{ stream: false },
			);

			await checkOpenAIState();
			logInfo("OpenAI configuration deleted successfully");
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			setError(t("openai.failedToDeleteConfiguration", { error: msg }));
			logError("Failed to delete config:", error);
		} finally {
			setIsLoading(false);
		}
	};

	// Validation helpers
	const isValidNewConfig =
		tempApiKey.trim().length > 0 && tempBaseUrl.trim().length > 0;

	return (
		<div className="space-y-4">
			{/* Security Notice */}
			<div className="p-3 border rounded-lg bg-muted/20 border-border">
				<div className="flex items-center gap-2 mb-2">
					<Shield className="w-4 h-4 text-primary" />
					<span className="text-sm font-medium text-foreground">
						{t("openai.secureStorage")}
					</span>
				</div>
				<p className="text-xs text-muted-foreground">
					{t("openai.masterKeySecurityDescription")}
				</p>
			</div>

			{/* Loading State */}
			{configState === "loading" && (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
					<span className="ml-2 text-sm text-muted-foreground">
						{t("openai.checkingConfiguration")}
					</span>
				</div>
			)}

			{/* No Configuration - Show Connect Form */}
			{configState === "no-config" && (
				<div className="space-y-4">
					<div className="text-center py-2">
						<h3 className="text-sm font-medium text-foreground mb-1">
							{t("openai.noConfigurationFound")}
						</h3>
						<p className="text-xs text-muted-foreground">
							{t("openai.createNewConfiguration")}
						</p>
					</div>

					<div className="grid grid-cols-1 gap-3">
						<div>
							<label className="text-xs text-muted-foreground">
								{t("openai.apiKey")} <span className="text-destructive">*</span>
							</label>
							<div className="relative">
								<Input
									type={showApiKey ? "text" : "password"}
									placeholder={t("openai.placeholders.apiKey")}
									value={tempApiKey}
									onChange={(e) => setTempApiKey(e.target.value)}
									disabled={isLoading}
									className="pr-10"
								/>
								<button
									type="button"
									onClick={() => setShowApiKey(!showApiKey)}
									className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
									disabled={isLoading}
								>
									{showApiKey ? (
										<EyeOff className="w-4 h-4 text-muted-foreground" />
									) : (
										<Eye className="w-4 h-4 text-muted-foreground" />
									)}
								</button>
							</div>
						</div>

						<div>
							<label className="text-xs text-muted-foreground">
								{t("openai.baseUrl")}
							</label>
							<Input
								placeholder={t("openai.placeholders.baseUrl")}
								value={tempBaseUrl}
								onChange={(e) => setTempBaseUrl(e.target.value)}
								disabled={isLoading}
							/>
							<div className="text-xs text-muted-foreground mt-1">
								{t("openai.baseUrlDescription")}
							</div>
						</div>
					</div>

					{/* Validation Warnings */}
					{tempApiKey.trim().length > 0 && !tempApiKey.startsWith("sk-") && (
						<div className="flex items-center gap-2 p-2 border rounded bg-muted/50 border-border">
							<AlertCircle className="w-4 h-4 text-muted-foreground" />
							<span className="text-xs text-muted-foreground">
								{t("openai.apiKeyWarning")}
							</span>
						</div>
					)}

					<Button
						onClick={handleSaveConfig}
						disabled={isLoading || !isValidNewConfig}
						className="w-full"
					>
						{isLoading ? (
							<>
								<Loader2 className="w-4 h-4 mr-2 animate-spin" />
								{t("openai.saving")}
							</>
						) : (
							<>
								<Shield className="w-4 h-4 mr-2" />
								{t("openai.saveAndEncrypt")}
							</>
						)}
					</Button>
				</div>
			)}

			{/* Has Configuration - Show Load Option */}
			{configState === "has-config" && (
				<div className="space-y-4">
					<div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/20 border-border">
						<CheckCircle className="w-4 h-4 text-primary" />
						<div className="flex-1">
							<div className="text-sm font-medium text-foreground">
								{t("openai.configurationFound")}
							</div>
							<div className="text-xs text-primary">
								{t("openai.createdDate", {
									date: configDate && configDate.toLocaleDateString(),
								})}
							</div>
						</div>
					</div>

					<div className="text-center py-2">
						<p className="text-xs text-muted-foreground">
							{t("openai.unlockWithMasterKey")}
						</p>
					</div>

					<div className="flex gap-2">
						<Button
							onClick={handleLoadConfig}
							disabled={isLoading}
							className="flex-1"
						>
							{isLoading ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									{t("openai.loading")}
								</>
							) : (
								<>
									<Shield className="w-4 h-4 mr-2" />
									{t("openai.loadConfiguration")}
								</>
							)}
						</Button>
						<Button
							onClick={handleDeleteConfig}
							disabled={isLoading}
							variant="outline"
							className="text-destructive hover:text-destructive hover:bg-destructive/10"
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
				</div>
			)}

			{/* Configuration Loaded - Show Success */}
			{configState === "loaded" && (
				<div className="space-y-4">
					<div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/20 border-border">
						<CheckCircle className="w-4 h-4 text-primary" />
						<div className="flex-1">
							<div className="text-sm font-medium text-foreground">
								{t("openai.openaiReady")}
							</div>
							<div className="text-xs text-primary">
								{t("openai.configurationLoadedAndConnected")}
							</div>
						</div>
					</div>

					<div className="text-center py-4">
						<p className="text-sm text-muted-foreground">
							{t("openai.modelsAvailableInYourModels")}
						</p>
					</div>

					<div className="flex gap-2">
						<Button
							onClick={() => setConfigState("has-config")}
							variant="outline"
							className="flex-1"
						>
							{t("openai.unloadConfiguration")}
						</Button>
						<Button
							onClick={handleDeleteConfig}
							disabled={isLoading}
							variant="outline"
							className="text-destructive hover:text-destructive hover:bg-destructive/10"
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
				</div>
			)}

			{/* Error Display */}
			{error && (
				<div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">
					<AlertCircle className="w-4 h-4" />
					{error}
				</div>
			)}

			{/* Master Key Setup Dialog */}
			<MasterKeySetupDialog
				open={showMasterKeySetup}
				onSetupComplete={handleMasterKeySetupComplete}
				onCancel={() => {
					setShowMasterKeySetup(false);
					setPendingSaveConfig(null);
				}}
			/>

			<PasskeyPromptDialog
				open={showMasterKeyUnlock}
				providers={unlockProviders}
				onPasskeySubmit={handleMasterKeyUnlockComplete}
				onForgotPasskey={handleForgotMasterPasskey}
				onCancel={() => {
					setShowMasterKeyUnlock(false);
					setPendingSaveConfig(null);
				}}
			/>
		</div>
	);
};
