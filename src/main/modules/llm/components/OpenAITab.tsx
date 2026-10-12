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
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { MasterKeySetupDialog } from "@/main/components/molecules/MasterKeySetupDialog";
import { PasskeyPromptDialog } from "@/main/components/molecules/PasskeyPromptDialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { DEFAULT_OPENAI_MODEL } from "@/constants/openai";
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
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import {
	normalizeCustomBaseURL,
	normalizeCustomModelIds,
} from "@/services/llm/utils/custom-provider";
import type { AuthProvider, StoredProviderConfig } from "@/utils/master-key";

interface OpenAICompatibleProviderTabProps {
	provider: "openai" | "custom";
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
	onConfigurationChange?: (ready: boolean) => void;
}

export const OpenAICompatibleProviderTab: React.FC<
	OpenAICompatibleProviderTabProps
> = ({ provider = "openai", onModelLoaded, onConfigurationChange }) => {
	const isCustom = provider === "custom";
	const formId = useId();
	const [isEditing, setIsEditing] = useState(false);
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
	const [tempBaseUrl, setTempBaseUrl] = useState(
		isCustom ? "" : "https://api.openai.com/v1",
	);
	const [showApiKey, setShowApiKey] = useState(false);
	const [tempModelIds, setTempModelIds] = useState("");

	// Master key setup dialog
	const [showMasterKeySetup, setShowMasterKeySetup] = useState(false);
	const [showMasterKeyUnlock, setShowMasterKeyUnlock] = useState(false);
	const [pendingLoad, setPendingLoad] = useState(false);
	const [unlockProviders, setUnlockProviders] = useState<AuthProvider[]>([]);
	const [pendingSaveConfig, setPendingSaveConfig] =
		useState<StoredProviderConfig | null>(null);

	// Check state on mount: DB -> memory -> ready
	useEffect(() => {
		checkProviderState();
	}, []);

	const checkProviderState = async () => {
		setConfigState("loading");
		try {
			// Check if already loaded in memory
			if (
				serviceManager.llmService.has(provider) &&
				(await secureSession.exists(`${provider}_ready`))
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
						.where(eq(schema.encryption.key, `${provider}_config`));
				})
			)[0];

			if (encryptedConfig) {
				setConfigState("has-config");
				setConfigDate(encryptedConfig.createdAt);
			} else {
				setConfigState("no-config");
			}
		} catch (error) {
			logError(`Failed to check ${provider} state:`, error);
			setConfigState("no-config");
		}
	};

	const saveAndActivateConfig = async (config: StoredProviderConfig) => {
		await saveProviderConfig(provider, config);
		if (isCustom && serviceManager.llmService.has(provider)) {
			await serviceManager.llmService.clearCurrentModelsForProvider(provider);
			serviceManager.llmService.remove(provider);
		}

		await serviceManager.llmService.create(provider, {
			type: provider,
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
			...(isCustom ? { modelIds: config.modelIds } : {}),
		});

		await secureSession.set(`${provider}_ready`, "true");

		const masterStrongPassword = await getMasterStrongPassword();
		if (masterStrongPassword) {
			await backgroundJob.execute(
				"restore-all-providers",
				{ masterStrongPassword },
				{ stream: false },
			);
		}

		setTempApiKey("");
		setIsEditing(false);
		setConfigState("loaded");
		logInfo(`${provider} configuration saved successfully`);
		onConfigurationChange?.(true);
		if (!isCustom) onModelLoaded?.(DEFAULT_OPENAI_MODEL, provider);
	};

	// Save new configuration to database
	const handleSaveConfig = async () => {
		if ((!isCustom && !tempApiKey.trim()) || !tempBaseUrl.trim()) {
			setError(t("openai.fillAllRequiredFields"));
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			if (isCustom) {
				try {
					normalizeCustomBaseURL(tempBaseUrl);
				} catch {
					setError(t("custom.invalidBaseUrl"));
					return;
				}
			}
			const config = {
				apiKey: tempApiKey.trim(),
				baseUrl: isCustom
					? normalizeCustomBaseURL(tempBaseUrl)
					: tempBaseUrl.trim(),
				...(isCustom
					? { modelIds: normalizeCustomModelIds(tempModelIds.split(/[,\n]/)) }
					: {}),
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
		if (pendingLoad) await handleLoadConfig();

		setShowMasterKeyUnlock(false);
		setPendingSaveConfig(null);
		setPendingLoad(false);
	};

	const handleForgotMasterPasskey = async () => {
		const deletedProviders = await resetMasterKeyAndEncryptedConfigs();
		// Chat and every studio lose a model whose key was just deleted.
		for (const provider of deletedProviders) {
			await serviceManager.llmService.clearCurrentModelsForProvider(provider);
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
		setPendingLoad(false);
		if (isCustom && !pendingSaveConfig) {
			await checkProviderState();
			onConfigurationChange?.(false);
		} else setShowMasterKeySetup(true);
	};

	// Load configuration (auto-load if master key is unlocked)
	const handleLoadConfig = async () => {
		setIsLoading(true);
		setError("");

		try {
			// Check if master key is unlocked
			const isUnlocked = await isMasterKeyUnlocked();
			if (!isUnlocked) {
				if (isCustom) {
					setUnlockProviders(await getEncryptedProviders());
					setPendingLoad(true);
					setShowMasterKeyUnlock(true);
					return;
				}
				setError(t("openai.masterKeyNotUnlocked"));
				setIsLoading(false);
				return;
			}

			// Load config
			const config = await loadProviderConfig(provider);
			if (!config) {
				setError(
					t(
						isCustom
							? "custom.noConfigurationFoundError"
							: "openai.noConfigurationFoundError",
					),
				);
				setIsLoading(false);
				return;
			}

			// Replace a custom client that may still be present after locking.
			if (isCustom && serviceManager.llmService.has(provider)) {
				serviceManager.llmService.remove(provider);
			}
			// Create the provider service.
			await serviceManager.llmService.create(provider, {
				type: provider,
				apiKey: config.apiKey,
				baseURL: config.baseUrl,
				...(isCustom ? { modelIds: config.modelIds } : {}),
			});

			// Mark as ready
			await secureSession.set(`${provider}_ready`, "true");

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
			logInfo(`${provider} configuration loaded successfully`);

			onConfigurationChange?.(true);
			if (!isCustom) onModelLoaded?.(DEFAULT_OPENAI_MODEL, provider);
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
		if (
			!confirm(
				t(
					isCustom
						? "custom.deleteConfigurationConfirm"
						: "openai.deleteConfigurationConfirm",
				),
			)
		) {
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			// Check if current model is using openai provider
			await serviceManager.llmService.clearCurrentModelsForProvider(provider);
			logInfo(
				`Cleared chat and studio models that used the ${provider} provider`,
			);

			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.delete(schema.encryption)
					.where(eq(schema.encryption.key, `${provider}_config`));
			});

			// Clear memory and remove the master key if no config still uses it.
			await secureSession.delete(`${provider}_ready`);
			await deleteMasterKeyIfUnused();

			// Remove LLM service
			if (serviceManager.llmService.has(provider)) {
				serviceManager.llmService.remove(provider);
				logInfo(`Removed ${provider} LLM service`);
			}

			// Also remove from offscreen thread via background job
			await backgroundJob.execute(
				"remove-auth-provider",
				{ provider: provider },
				{ stream: false },
			);

			await checkProviderState();
			onConfigurationChange?.(false);
			logInfo("Provider configuration deleted successfully");
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
		(isCustom || tempApiKey.trim().length > 0) && tempBaseUrl.trim().length > 0;

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
							{t(
								isEditing
									? "custom.editConfiguration"
									: "openai.noConfigurationFound",
							)}
						</h3>
						<p className="text-xs text-muted-foreground">
							{t(
								isCustom
									? "custom.description"
									: "openai.createNewConfiguration",
							)}
						</p>
					</div>

					<div className="grid grid-cols-1 gap-3">
						<div>
							<label
								htmlFor={`${formId}-api-key`}
								className="text-xs text-muted-foreground"
							>
								{t(isCustom ? "custom.apiKey" : "openai.apiKey")}{" "}
								{isCustom ? (
									t("custom.optional")
								) : (
									<span className="text-destructive">*</span>
								)}
							</label>
							<div className="relative">
								<Input
									id={`${formId}-api-key`}
									aria-required={!isCustom}
									type={showApiKey ? "text" : "password"}
									placeholder={t(
										isCustom
											? "custom.apiKeyPlaceholder"
											: "openai.placeholders.apiKey",
									)}
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
							<label
								htmlFor={`${formId}-base-url`}
								className="text-xs text-muted-foreground"
							>
								{t("openai.baseUrl")}
							</label>
							<Input
								id={`${formId}-base-url`}
								aria-required={true}
								placeholder={t(
									isCustom
										? "custom.baseUrlPlaceholder"
										: "openai.placeholders.baseUrl",
								)}
								value={tempBaseUrl}
								onChange={(e) => setTempBaseUrl(e.target.value)}
								disabled={isLoading}
							/>
							<div className="text-xs text-muted-foreground mt-1">
								{t(
									isCustom
										? "custom.baseUrlDescription"
										: "openai.baseUrlDescription",
								)}
							</div>
						</div>
					</div>

					{isCustom && (
						<div>
							<label
								htmlFor={`${formId}-model-ids`}
								className="text-xs text-muted-foreground"
							>
								{t("custom.modelIds")}
							</label>
							<Input
								id={`${formId}-model-ids`}
								placeholder={t("custom.modelIdsPlaceholder")}
								value={tempModelIds}
								onChange={(event) => setTempModelIds(event.target.value)}
								disabled={isLoading}
							/>
							<p className="text-xs text-muted-foreground mt-1">
								{t("custom.modelIdsDescription")}
							</p>
						</div>
					)}

					{/* Validation Warnings */}
					{!isCustom &&
						tempApiKey.trim().length > 0 &&
						!tempApiKey.startsWith("sk-") && (
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
							{t(
								isCustom
									? "custom.unlockWithMasterKey"
									: "openai.unlockWithMasterKey",
							)}
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
								{t(isCustom ? "custom.ready" : "openai.openaiReady")}
							</div>
							<div className="text-xs text-primary">
								{t("openai.configurationLoadedAndConnected")}
							</div>
						</div>
					</div>

					<div className="text-center py-4">
						<p className="text-sm text-muted-foreground">
							{t(
								isCustom
									? "custom.modelsAvailable"
									: "openai.modelsAvailableInYourModels",
							)}
						</p>
					</div>

					<div className="flex gap-2">
						<Button
							onClick={async () => {
								if (isCustom) {
									try {
										const config = await loadProviderConfig(provider);
										if (!config) return;
										setTempApiKey(config.apiKey);
										setTempBaseUrl(config.baseUrl);
										setTempModelIds(config.modelIds?.join(", ") ?? "");
										setIsEditing(true);
										setConfigState("no-config");
									} catch (error) {
										setError(
											error instanceof Error ? error.message : String(error),
										);
									}
								} else setConfigState("has-config");
							}}
							variant="outline"
							className="flex-1"
						>
							{t(
								isCustom
									? "custom.editConfiguration"
									: "openai.unloadConfiguration",
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
					setPendingLoad(false);
				}}
			/>
		</div>
	);
};

export const OpenAITab: React.FC<
	Omit<OpenAICompatibleProviderTabProps, "provider">
> = (props) => <OpenAICompatibleProviderTab {...props} provider="openai" />;
