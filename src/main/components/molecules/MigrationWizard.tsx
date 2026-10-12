import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import {
	Eye,
	EyeOff,
	Key,
	Shield,
	AlertCircle,
	Loader2,
	CheckCircle,
	ArrowRight,
	RefreshCw,
} from "lucide-react";
import {
	getLegacyProviders,
	setupMasterKey,
	migrateLegacyConfig,
	hasMasterKey,
} from "@/utils/master-key";

type AuthProvider = "openai" | "openrouter" | "custom";

interface MigrationWizardProps {
	open: boolean;
	onMigrationComplete: () => void;
	onCancel?: () => void;
}

type WizardStep = "setup-master" | "migrate-providers" | "complete";

export const MigrationWizard: React.FC<MigrationWizardProps> = ({
	open,
	onMigrationComplete,
	onCancel,
}) => {
	const { t } = useTranslation("common");
	const [step, setStep] = useState<WizardStep>("setup-master");
	const [legacyProviders, setLegacyProviders] = useState<AuthProvider[]>([]);
	const [currentProviderIndex, setCurrentProviderIndex] = useState(0);
	const [migratedProviders, setMigratedProviders] = useState<AuthProvider[]>(
		[],
	);
	const [skippedProviders, setSkippedProviders] = useState<AuthProvider[]>([]);

	// Master key setup state
	const [masterPasskey, setMasterPasskey] = useState("");
	const [confirmMasterPasskey, setConfirmMasterPasskey] = useState("");
	const [showMasterPasskey, setShowMasterPasskey] = useState(false);

	// Provider passkey state
	const [providerPasskey, setProviderPasskey] = useState("");
	const [showProviderPasskey, setShowProviderPasskey] = useState(false);

	// UI state
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	// Load legacy providers on mount
	useEffect(() => {
		const loadProviders = async () => {
			const providers = await getLegacyProviders();
			setLegacyProviders(providers);

			// Check if master key already exists
			const hasMaster = await hasMasterKey();
			if (hasMaster && providers.length > 0) {
				setStep("migrate-providers");
			}
		};
		if (open) {
			loadProviders();
		}
	}, [open]);

	const currentProvider = legacyProviders[currentProviderIndex];
	const isLastProvider = currentProviderIndex >= legacyProviders.length - 1;

	const getProviderLabel = (provider: AuthProvider) => {
		return provider === "openai" ? "OpenAI" : "OpenRouter";
	};

	// Master key setup validation
	const isMasterPasskeyValid = masterPasskey.length >= 6;
	const masterPasskeysMatch = masterPasskey === confirmMasterPasskey;
	const canSetupMaster =
		isMasterPasskeyValid &&
		masterPasskeysMatch &&
		confirmMasterPasskey.length > 0;

	// Handle master key setup
	const handleSetupMasterKey = async () => {
		if (!canSetupMaster) return;

		setIsLoading(true);
		setError("");

		try {
			await setupMasterKey(masterPasskey);
			setStep("migrate-providers");
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("migration.errors.setupFailed"),
			);
		} finally {
			setIsLoading(false);
		}
	};

	// Handle provider migration
	const handleMigrateProvider = async () => {
		if (!providerPasskey || providerPasskey.length !== 6) {
			setError(t("migration.errors.invalidPasskey"));
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			await migrateLegacyConfig(currentProvider, providerPasskey);
			setMigratedProviders((prev) => [...prev, currentProvider]);
			setProviderPasskey("");

			if (isLastProvider) {
				setStep("complete");
			} else {
				setCurrentProviderIndex((prev) => prev + 1);
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("migration.errors.migrateFailed"),
			);
		} finally {
			setIsLoading(false);
		}
	};

	// Handle skip provider
	const handleSkipProvider = () => {
		setSkippedProviders((prev) => [...prev, currentProvider]);
		setProviderPasskey("");
		setError("");

		if (isLastProvider) {
			setStep("complete");
		} else {
			setCurrentProviderIndex((prev) => prev + 1);
		}
	};

	// Handle completion
	const handleComplete = () => {
		onMigrationComplete();
	};

	const renderMasterKeySetup = () => (
		<div className="space-y-4">
			<div className="p-3 border rounded-lg bg-muted/20 border-border">
				<div className="flex items-start gap-2">
					<Shield className="w-4 h-4 text-primary mt-0.5" />
					<div className="text-xs text-muted-foreground">
						{t("migration.masterKeyInfo")}
					</div>
				</div>
			</div>

			<div>
				<label className="text-sm text-muted-foreground mb-2 block">
					{t("masterKeySetup.passkeyLabel")}{" "}
					<span className="text-destructive">*</span>
				</label>
				<div className="relative">
					<Input
						type={showMasterPasskey ? "text" : "password"}
						placeholder={t("masterKeySetup.passkeyPlaceholder")}
						value={masterPasskey}
						onChange={(e) => setMasterPasskey(e.target.value)}
						disabled={isLoading}
						className="pr-10"
						autoFocus
					/>
					<button
						type="button"
						onClick={() => setShowMasterPasskey(!showMasterPasskey)}
						className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
					>
						{showMasterPasskey ? (
							<EyeOff className="w-4 h-4 text-muted-foreground" />
						) : (
							<Eye className="w-4 h-4 text-muted-foreground" />
						)}
					</button>
				</div>
				{masterPasskey.length > 0 && masterPasskey.length < 6 && (
					<span className="text-xs text-muted-foreground mt-1 block">
						{t("masterKeySetup.minLength", { current: masterPasskey.length })}
					</span>
				)}
			</div>

			<div>
				<label className="text-sm text-muted-foreground mb-2 block">
					{t("masterKeySetup.confirmLabel")}{" "}
					<span className="text-destructive">*</span>
				</label>
				<div className="relative">
					<Input
						type={showMasterPasskey ? "text" : "password"}
						placeholder={t("masterKeySetup.confirmPlaceholder")}
						value={confirmMasterPasskey}
						onChange={(e) => setConfirmMasterPasskey(e.target.value)}
						disabled={isLoading}
						className="pr-10"
					/>
				</div>
				{confirmMasterPasskey.length > 0 && !masterPasskeysMatch && (
					<div className="flex items-center gap-1 mt-1">
						<AlertCircle className="w-3 h-3 text-destructive" />
						<span className="text-xs text-destructive">
							{t("masterKeySetup.passkeysNoMatch")}
						</span>
					</div>
				)}
			</div>

			<Button
				onClick={handleSetupMasterKey}
				disabled={isLoading || !canSetupMaster}
				className="w-full"
			>
				{isLoading ? (
					<>
						<Loader2 className="w-4 h-4 mr-2 animate-spin" />
						{t("migration.settingUp")}
					</>
				) : (
					<>
						<ArrowRight className="w-4 h-4 mr-2" />
						{t("migration.continueToMigration")}
					</>
				)}
			</Button>
		</div>
	);

	const renderProviderMigration = () => (
		<div className="space-y-4">
			{/* Progress indicator */}
			<div className="flex items-center gap-2">
				{legacyProviders.map((provider, index) => (
					<div
						key={provider}
						className={`flex-1 h-2 rounded ${
							index < currentProviderIndex
								? "bg-green-500"
								: index === currentProviderIndex
									? "bg-primary"
									: "bg-muted"
						}`}
					/>
				))}
			</div>

			<div className="text-center">
				<span className="text-sm text-muted-foreground">
					{t("migration.providerProgress", {
						current: currentProviderIndex + 1,
						total: legacyProviders.length,
					})}
				</span>
			</div>

			<div className="p-3 border rounded-lg bg-muted/20 border-border">
				<div className="flex items-center gap-2 mb-2">
					<RefreshCw className="w-4 h-4 text-primary" />
					<span className="text-sm font-medium">
						{t("migration.migratingProvider", {
							provider: getProviderLabel(currentProvider),
						})}
					</span>
				</div>
				<p className="text-xs text-muted-foreground">
					{t("migration.enterOldPasskey", {
						provider: getProviderLabel(currentProvider),
					})}
				</p>
			</div>

			<div>
				<label className="text-sm text-muted-foreground mb-2 block">
					{t("migration.oldPasskeyLabel", {
						provider: getProviderLabel(currentProvider),
					})}{" "}
					<span className="text-destructive">*</span>
				</label>
				<div className="relative">
					<Input
						type={showProviderPasskey ? "text" : "password"}
						placeholder={t("passkeyDialog.placeholder")}
						value={providerPasskey}
						onChange={(e) => setProviderPasskey(e.target.value.slice(0, 6))}
						disabled={isLoading}
						className="pr-10"
						maxLength={6}
						autoFocus
					/>
					<button
						type="button"
						onClick={() => setShowProviderPasskey(!showProviderPasskey)}
						className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
					>
						{showProviderPasskey ? (
							<EyeOff className="w-4 h-4 text-muted-foreground" />
						) : (
							<Eye className="w-4 h-4 text-muted-foreground" />
						)}
					</button>
				</div>
			</div>

			<div className="flex gap-2">
				<Button
					onClick={handleMigrateProvider}
					disabled={isLoading || providerPasskey.length !== 6}
					className="flex-1"
				>
					{isLoading ? (
						<>
							<Loader2 className="w-4 h-4 mr-2 animate-spin" />
							{t("migration.migrating")}
						</>
					) : (
						<>
							<CheckCircle className="w-4 h-4 mr-2" />
							{t("migration.migrateButton")}
						</>
					)}
				</Button>
				<Button
					onClick={handleSkipProvider}
					variant="outline"
					disabled={isLoading}
				>
					{t("migration.skip")}
				</Button>
			</div>

			<div className="text-xs text-muted-foreground text-center">
				{t("migration.skipInfo")}
			</div>
		</div>
	);

	const renderComplete = () => (
		<div className="space-y-4">
			<div className="text-center py-4">
				<CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
				<h3 className="text-lg font-medium mb-2">
					{t("migration.complete.title")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t("migration.complete.description")}
				</p>
			</div>

			{migratedProviders.length > 0 && (
				<div className="p-3 border rounded-lg bg-green-500/10 border-green-500/20">
					<div className="flex items-center gap-2 mb-1">
						<CheckCircle className="w-4 h-4 text-green-500" />
						<span className="text-sm font-medium text-green-600">
							{t("migration.complete.migrated")}
						</span>
					</div>
					<div className="text-xs text-muted-foreground">
						{migratedProviders.map(getProviderLabel).join(", ")}
					</div>
				</div>
			)}

			{skippedProviders.length > 0 && (
				<div className="p-3 border rounded-lg bg-orange-500/10 border-orange-500/20">
					<div className="flex items-center gap-2 mb-1">
						<AlertCircle className="w-4 h-4 text-orange-500" />
						<span className="text-sm font-medium text-orange-600">
							{t("migration.complete.skipped")}
						</span>
					</div>
					<div className="text-xs text-muted-foreground">
						{skippedProviders.map(getProviderLabel).join(", ")}
					</div>
					<div className="text-xs text-muted-foreground mt-1">
						{t("migration.complete.skippedInfo")}
					</div>
				</div>
			)}

			<Button onClick={handleComplete} className="w-full">
				<ArrowRight className="w-4 h-4 mr-2" />
				{t("migration.complete.continue")}
			</Button>
		</div>
	);

	return (
		<Dialog open={open} onOpenChange={() => {}}>
			<DialogContent
				className="sm:max-w-md w-[calc(100%-20px)]"
				onInteractOutside={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Key className="w-5 h-5 text-primary" />
						{step === "setup-master" && t("migration.title.setup")}
						{step === "migrate-providers" && t("migration.title.migrate")}
						{step === "complete" && t("migration.title.complete")}
					</DialogTitle>
					<DialogDescription>
						{step === "setup-master" && t("migration.description.setup")}
						{step === "migrate-providers" && t("migration.description.migrate")}
						{step === "complete" && t("migration.description.complete")}
					</DialogDescription>
				</DialogHeader>

				{error && (
					<div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">
						<AlertCircle className="w-4 h-4" />
						{error}
					</div>
				)}

				{step === "setup-master" && renderMasterKeySetup()}
				{step === "migrate-providers" && renderProviderMigration()}
				{step === "complete" && renderComplete()}

				{onCancel && step !== "complete" && (
					<div className="text-center pt-2 border-t">
						<button
							onClick={onCancel}
							className="text-xs text-muted-foreground hover:text-foreground"
							disabled={isLoading}
						>
							{t("migration.cancelLink")}
						</button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};
