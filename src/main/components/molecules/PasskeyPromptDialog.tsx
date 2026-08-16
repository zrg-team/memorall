import React, { useEffect, useState } from "react";
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
	AlertCircle,
	AlertTriangle,
	Eye,
	EyeOff,
	Key,
	Loader2,
	Shield,
} from "lucide-react";

interface PasskeyPromptDialogProps {
	open: boolean;
	/** List of providers that will be unlocked */
	providers?: string[];
	onPasskeySubmit: (passkey: string) => Promise<void>;
	onCancel: () => void;
	/** Reset the master key after the user confirms encrypted data deletion. */
	onForgotPasskey?: () => Promise<void>;
}

export const PasskeyPromptDialog: React.FC<PasskeyPromptDialogProps> = ({
	open,
	providers = [],
	onPasskeySubmit,
	onCancel,
	onForgotPasskey,
}) => {
	const { t } = useTranslation("common");
	const [passkey, setPasskey] = useState("");
	const [showPasskey, setShowPasskey] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isResetting, setIsResetting] = useState(false);
	const [showResetConfirmation, setShowResetConfirmation] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!open) {
			setPasskey("");
			setError("");
			setShowResetConfirmation(false);
		}
	}, [open]);

	// Format provider list for display
	const providerLabels = providers.map((p) =>
		p === "openai" ? "OpenAI" : p === "openrouter" ? "OpenRouter" : p,
	);
	const providerText =
		providerLabels.length > 0
			? providerLabels.join(", ")
			: t("passkeyDialog.allProviders");

	const handleSubmit = async () => {
		if (passkey.length < 6) {
			setError(t("passkeyDialog.lengthError"));
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			await onPasskeySubmit(passkey);
			// Success - dialog will be closed by parent
		} catch (err) {
			const msg =
				err instanceof Error ? err.message : t("passkeyDialog.decryptError");
			setError(msg);
		} finally {
			setIsLoading(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && passkey.length >= 6 && !isLoading) {
			handleSubmit();
		}
	};

	const handleCancelClick = () => {
		const confirmed = window.confirm(t("passkeyDialog.masterCancelConfirm"));

		if (confirmed) {
			onCancel();
		}
	};

	const handleReset = async () => {
		if (!onForgotPasskey) return;

		setIsResetting(true);
		setError("");
		try {
			await onForgotPasskey();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("passkeyDialog.resetError"),
			);
		} finally {
			setIsResetting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={() => {}}>
			<DialogContent
				className="sm:max-w-md w-[calc(100%-20px)]"
				onInteractOutside={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{showResetConfirmation ? (
							<AlertTriangle className="w-5 h-5 text-destructive" />
						) : (
							<Shield className="w-5 h-5 text-primary" />
						)}
						{showResetConfirmation
							? t("passkeyDialog.resetTitle")
							: t("passkeyDialog.masterTitle")}
					</DialogTitle>
					<DialogDescription>
						{showResetConfirmation
							? t("passkeyDialog.resetDescription")
							: t("passkeyDialog.masterDescription", {
									providers: providerText,
								})}
					</DialogDescription>
				</DialogHeader>

				{showResetConfirmation ? (
					<div className="space-y-4">
						<div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
							<div className="space-y-2 text-sm">
								<p className="font-medium text-destructive">
									{t("passkeyDialog.resetWarning")}
								</p>
								{providerLabels.length > 0 && (
									<p className="text-muted-foreground">
										{t("passkeyDialog.resetProviders", {
											providers: providerLabels.join(", "),
										})}
									</p>
								)}
							</div>
						</div>

						{error && (
							<div className="flex items-center gap-2 rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
								<AlertCircle className="h-4 w-4" />
								{error}
							</div>
						)}

						<div className="flex gap-2">
							<Button
								onClick={() => {
									setError("");
									setShowResetConfirmation(false);
								}}
								disabled={isResetting}
								variant="outline"
								className="flex-1"
							>
								{t("passkeyDialog.resetCancel")}
							</Button>
							<Button
								onClick={handleReset}
								disabled={isResetting}
								variant="destructive"
								className="flex-1"
							>
								{isResetting ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										{t("passkeyDialog.resetting")}
									</>
								) : (
									t("passkeyDialog.resetConfirm")
								)}
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{/* Info about what will be unlocked */}
						{providers.length > 0 && (
							<div className="p-3 border rounded-lg bg-muted/20 border-border">
								<div className="flex items-start gap-2">
									<Key className="w-4 h-4 text-primary mt-0.5" />
									<div>
										<div className="text-xs text-muted-foreground">
											{t("passkeyDialog.willUnlock")}
										</div>
										<div className="text-sm font-medium mt-1">
											{providerLabels.join(", ")}
										</div>
									</div>
								</div>
							</div>
						)}

						<div>
							<label className="text-sm text-muted-foreground mb-2 block">
								{t("passkeyDialog.masterPasskeyLabel")}{" "}
								<span className="text-destructive">*</span>
							</label>
							<div className="relative">
								<Input
									type={showPasskey ? "text" : "password"}
									placeholder={t("passkeyDialog.masterPlaceholder")}
									value={passkey}
									onChange={(e) => setPasskey(e.target.value)}
									onKeyDown={handleKeyDown}
									disabled={isLoading}
									className="pr-10"
									autoFocus
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
							{passkey.length > 0 && passkey.length < 6 && (
								<div className="flex items-center gap-2 p-2 mt-2 border rounded bg-muted/50 border-border">
									<AlertCircle className="w-4 h-4 text-muted-foreground" />
									<span className="text-xs text-muted-foreground">
										{t("passkeyDialog.masterLengthHint", {
											current: passkey.length,
										})}
									</span>
								</div>
							)}
						</div>

						{error && (
							<div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded border border-destructive/20">
								<AlertCircle className="w-4 h-4" />
								{error}
							</div>
						)}

						<div className="flex gap-2">
							<Button
								onClick={handleSubmit}
								disabled={isLoading || passkey.length < 6}
								className="flex-1"
							>
								{isLoading ? (
									<>
										<Loader2 className="w-4 h-4 mr-2 animate-spin" />
										{t("passkeyDialog.decrypting")}
									</>
								) : (
									<>
										<Key className="w-4 h-4 mr-2" />
										{t("passkeyDialog.unlockAll")}
									</>
								)}
							</Button>
							<Button
								onClick={handleCancelClick}
								disabled={isLoading}
								variant="outline"
								className="flex-1"
							>
								{t("passkeyDialog.cancel")}
							</Button>
						</div>

						<div className="text-xs text-muted-foreground text-center pt-2 border-t">
							{t("passkeyDialog.masterHelpText")}
						</div>

						{onForgotPasskey && (
							<Button
								type="button"
								variant="link"
								className="h-auto w-full text-destructive"
								onClick={() => {
									setError("");
									setShowResetConfirmation(true);
								}}
							>
								{t("passkeyDialog.forgotPasskey")}
							</Button>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};
