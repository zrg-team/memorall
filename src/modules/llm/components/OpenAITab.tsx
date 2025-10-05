import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Eye,
	EyeOff,
	Key,
	Shield,
	CheckCircle,
	AlertCircle,
	Loader2,
	Trash2,
} from "lucide-react";
import { serviceManager } from "@/services";
import { eq } from "drizzle-orm";
import { FIXED_ENCRYPTION_KEY } from "@/config/security";
import {
	generateStrongPasswordBase64,
	deriveAesKeyFromString,
	deriveAesKeyFromCombined,
	encryptStringAes,
	decryptStringAes,
} from "@/utils/aes";
import secureSession from "@/utils/secure-session";
import { logError, logInfo } from "@/utils/logger";

interface OpenAITabProps {
	onModelLoaded?: (modelId: string, provider: "openai") => void;
}

export const OpenAITab: React.FC<OpenAITabProps> = ({ onModelLoaded }) => {
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
	const [tempPasskey, setTempPasskey] = useState("");
	const [showApiKey, setShowApiKey] = useState(false);
	const [showPasskey, setShowPasskey] = useState(false);

	// Form states for loading existing configuration
	const [loadPasskey, setLoadPasskey] = useState("");
	const [showLoadPasskey, setShowLoadPasskey] = useState(false);

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

	// Save new configuration to database
	const handleSaveConfig = async () => {
		if (!tempApiKey.trim() || !tempPasskey.trim() || tempPasskey.length !== 6) {
			setError(
				"Please fill all required fields and ensure passkey is 6 characters",
			);
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			// Create config object
			const config = {
				apiKey: tempApiKey.trim(),
				baseUrl: tempBaseUrl.trim(),
			};

			// Generate strong password and encrypt it with user passkey
			const strongPassword = generateStrongPasswordBase64();
			const passkeyKey = await deriveAesKeyFromString(tempPasskey);
			const advancedSeed = await encryptStringAes(strongPassword, passkeyKey);

			// Combine strong password with fixed key and encrypt config
			const combinedKey = await deriveAesKeyFromCombined(
				strongPassword,
				FIXED_ENCRYPTION_KEY,
			);
			const encryptedData = await encryptStringAes(
				JSON.stringify(config),
				combinedKey,
			);

			// Insert or update
			const existing = (
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.select()
						.from(schema.encryption)
						.where(eq(schema.encryption.key, "openai_config"));
				})
			)[0];

			if (existing) {
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.update(schema.encryption)
						.set({ encryptedData, advancedSeed, updatedAt: new Date() })
						.where(eq(schema.encryption.key, "openai_config"));
				});
			} else {
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db.insert(schema.encryption).values({
						key: "openai_config",
						encryptedData,
						advancedSeed,
					});
				});
			}

			// Store passkey in secure session for convenience
			await secureSession.set("openai_passkey", tempPasskey);

			// Clear form and refresh
			setTempApiKey("");
			setTempPasskey("");
			await checkOpenAIState();
			logInfo("OpenAI configuration saved successfully");
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			setError(`Failed to save configuration: ${msg}`);
			logError("Failed to save config:", error);
		} finally {
			setIsLoading(false);
		}
	};

	// Load configuration from database to memory
	const handleLoadConfig = async () => {
		if (!loadPasskey.trim() || loadPasskey.length !== 6) {
			setError("Please enter a valid 6-character passkey");
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			const encryptedConfig = (
				await serviceManager.databaseService.use(({ db, schema }) => {
					return db
						.select()
						.from(schema.encryption)
						.where(eq(schema.encryption.key, "openai_config"));
				})
			)[0];

			if (!encryptedConfig) {
				setError("No OpenAI configuration found");
				return;
			}

			// Decrypt strong password using user-entered passkey
			const passkeyKey = await deriveAesKeyFromString(loadPasskey);
			const strongPassword = await decryptStringAes(
				encryptedConfig.advancedSeed || "",
				passkeyKey,
			);

			// Combine with fixed key and decrypt config
			const combinedKey = await deriveAesKeyFromCombined(
				strongPassword,
				FIXED_ENCRYPTION_KEY,
			);
			const decryptedData = await decryptStringAes(
				encryptedConfig.encryptedData,
				combinedKey,
			);
			const config = JSON.parse(decryptedData);

			// Create OpenAI service
			await serviceManager.llmService.create("openai", {
				type: "openai",
				apiKey: config.apiKey,
				baseURL: config.baseUrl,
			});

			// Mark as ready in memory
			await secureSession.set("openai_ready", "true");
			await secureSession.set("openai_passkey", loadPasskey);
			await secureSession.set(
				"openai_combined_key",
				strongPassword + FIXED_ENCRYPTION_KEY,
			);

			setConfigState("loaded");
			setLoadPasskey("");
			logInfo("OpenAI configuration loaded successfully");

			// Notify parent that model is ready
			onModelLoaded?.("gpt-4o", "openai");
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			setError(`Failed to load configuration: ${msg}`);
			logError("Failed to load config:", error);
		} finally {
			setIsLoading(false);
		}
	};

	// Delete configuration from database
	const handleDeleteConfig = async () => {
		if (
			!confirm("Are you sure you want to delete your OpenAI configuration?")
		) {
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			await serviceManager.databaseService.use(({ db, schema }) => {
				return db
					.delete(schema.encryption)
					.where(eq(schema.encryption.key, "openai_config"));
			});

			// Clear memory
			await secureSession.set("openai_ready", "");
			await secureSession.set("openai_passkey", "");
			await secureSession.set("openai_combined_key", "");

			await checkOpenAIState();
			logInfo("OpenAI configuration deleted successfully");
		} catch (error) {
			const msg = error instanceof Error ? error.message : "Unknown error";
			setError(`Failed to delete configuration: ${msg}`);
			logError("Failed to delete config:", error);
		} finally {
			setIsLoading(false);
		}
	};

	// Validation helpers
	const isValidNewConfig =
		tempApiKey.trim().length > 0 &&
		tempBaseUrl.trim().length > 0 &&
		tempPasskey.length === 6;
	const isValidLoadConfig = loadPasskey.length === 6;

	return (
		<div className="space-y-4">
			{/* Security Notice */}
			<div className="p-3 border rounded-lg bg-muted/20 border-border">
				<div className="flex items-center gap-2 mb-2">
					<Shield className="w-4 h-4 text-primary" />
					<span className="text-sm font-medium text-foreground">
						Secure Storage
					</span>
				</div>
				<p className="text-xs text-muted-foreground">
					Your API key is encrypted with AES-256 and stored securely on disk. A
					6-character passkey protects your configuration.
				</p>
			</div>

			{/* Loading State */}
			{configState === "loading" && (
				<div className="flex items-center justify-center py-8">
					<Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
					<span className="ml-2 text-sm text-muted-foreground">
						Checking configuration...
					</span>
				</div>
			)}

			{/* No Configuration - Show Connect Form */}
			{configState === "no-config" && (
				<div className="space-y-4">
					<div className="text-center py-2">
						<h3 className="text-sm font-medium text-foreground mb-1">
							No Configuration Found
						</h3>
						<p className="text-xs text-muted-foreground">
							Create a new OpenAI configuration
						</p>
					</div>

					<div className="grid grid-cols-1 gap-3">
						<div>
							<label className="text-xs text-muted-foreground">
								OpenAI API Key <span className="text-destructive">*</span>
							</label>
							<div className="relative">
								<Input
									type={showApiKey ? "text" : "password"}
									placeholder="sk-..."
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
							<label className="text-xs text-muted-foreground">Base URL</label>
							<Input
								placeholder="https://api.openai.com/v1"
								value={tempBaseUrl}
								onChange={(e) => setTempBaseUrl(e.target.value)}
								disabled={isLoading}
							/>
							<div className="text-xs text-muted-foreground mt-1">
								Use a different base URL for OpenAI-compatible APIs (optional)
							</div>
						</div>

						<div>
							<label className="text-xs text-muted-foreground">
								Encryption Passkey <span className="text-destructive">*</span>
							</label>
							<div className="relative">
								<Input
									type={showPasskey ? "text" : "password"}
									placeholder="6 characters"
									value={tempPasskey}
									onChange={(e) => setTempPasskey(e.target.value.slice(0, 6))}
									disabled={isLoading}
									className="pr-10"
									maxLength={6}
								/>
								<button
									type="button"
									onClick={() => setShowPasskey(!showPasskey)}
									className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
									disabled={isLoading}
								>
									{showPasskey ? (
										<EyeOff className="w-4 h-4 text-muted-foreground" />
									) : (
										<Eye className="w-4 h-4 text-muted-foreground" />
									)}
								</button>
							</div>
							<div className="text-xs text-muted-foreground mt-1">
								6-character password to encrypt your configuration
							</div>
						</div>
					</div>

					{/* Validation Warnings */}
					{tempApiKey.trim().length > 0 && !tempApiKey.startsWith("sk-") && (
						<div className="flex items-center gap-2 p-2 border rounded bg-muted/50 border-border">
							<AlertCircle className="w-4 h-4 text-muted-foreground" />
							<span className="text-xs text-muted-foreground">
								OpenAI API keys typically start with "sk-"
							</span>
						</div>
					)}

					{tempPasskey.length > 0 && tempPasskey.length !== 6 && (
						<div className="flex items-center gap-2 p-2 border rounded bg-muted/50 border-border">
							<AlertCircle className="w-4 h-4 text-muted-foreground" />
							<span className="text-xs text-muted-foreground">
								Passkey must be exactly 6 characters ({tempPasskey.length}/6)
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
								Saving...
							</>
						) : (
							<>
								<Shield className="w-4 h-4 mr-2" />
								Save & Encrypt Configuration
							</>
						)}
					</Button>
				</div>
			)}

			{/* Has Configuration - Show Use Form */}
			{configState === "has-config" && (
				<div className="space-y-4">
					<div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/20 border-border">
						<CheckCircle className="w-4 h-4 text-primary" />
						<div className="flex-1">
							<div className="text-sm font-medium text-foreground">
								Configuration Found
							</div>
							<div className="text-xs text-primary">
								Created: {configDate && configDate.toLocaleDateString()}
							</div>
						</div>
					</div>

					<div className="text-center py-2">
						<h3 className="text-sm font-medium text-foreground mb-1">
							Enter Passkey to Load
						</h3>
						<p className="text-xs text-muted-foreground">
							Decrypt your saved OpenAI configuration
						</p>
					</div>

					<div>
						<label className="text-xs text-muted-foreground">
							Encryption Passkey <span className="text-destructive">*</span>
						</label>
						<div className="relative">
							<Input
								type={showLoadPasskey ? "text" : "password"}
								placeholder="6 characters"
								value={loadPasskey}
								onChange={(e) => setLoadPasskey(e.target.value.slice(0, 6))}
								disabled={isLoading}
								className="pr-10"
								maxLength={6}
								onKeyDown={(e) =>
									e.key === "Enter" && isValidLoadConfig && handleLoadConfig()
								}
							/>
							<button
								type="button"
								onClick={() => setShowLoadPasskey(!showLoadPasskey)}
								className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
								disabled={isLoading}
							>
								{showLoadPasskey ? (
									<EyeOff className="w-4 h-4 text-muted-foreground" />
								) : (
									<Eye className="w-4 h-4 text-muted-foreground" />
								)}
							</button>
						</div>
					</div>

					<div className="flex gap-2">
						<Button
							onClick={handleLoadConfig}
							disabled={isLoading || !isValidLoadConfig}
							className="flex-1"
						>
							{isLoading ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin" />
									Loading...
								</>
							) : (
								<>
									<Key className="w-4 h-4 mr-2" />
									Load Configuration
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
								OpenAI Ready
							</div>
							<div className="text-xs text-primary">
								Configuration loaded and service connected
							</div>
						</div>
					</div>

					<div className="text-center py-4">
						<p className="text-sm text-muted-foreground">
							Your OpenAI models are now available in the{" "}
							<strong>Your Models</strong> section above.
						</p>
					</div>

					<div className="flex gap-2">
						<Button
							onClick={() => setConfigState("has-config")}
							variant="outline"
							className="flex-1"
						>
							Unload Configuration
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
		</div>
	);
};
