import React from "react";
import { useNavigate } from "react-router-dom";
import {
	VectorSquareIcon,
	Sun,
	Moon,
	Monitor,
	Languages,
	Settings,
	// GitBranch,
	LogIn,
	LogOut,
	User as UserIcon,
	HelpCircle,
} from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
	DropdownMenuLabel,
} from "@/main/components/ui/dropdown-menu";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import {
	useCurrentEmbeddingSize,
	useHasExistingData,
	useEmbeddingSettings,
} from "@/main/stores/embedding-settings";
import { useLanguage } from "@/main/i18n/hooks/useLanguage";
import { useTranslation } from "react-i18next";
import {
	EMBEDDING_MODELS,
	type EmbeddingSize,
	getAvailableSizes,
} from "@/config/embedding-models";
import { useCopilot } from "@/main/components/atoms/copilot";
import { getCurrentEmbeddingSize } from "@/utils/embedding-size-config";
import { VietnamFlag, USFlag } from "@/main/components/atoms/flags";
import { useAuth, useAuthActions } from "@/main/modules/supabase";
import { MANAGED_SERVICE_ENABLED } from "@/constants/features";
import { cn } from "@/lib/utils";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { logError, logInfo } from "@/utils/logger";

import manifest from "../../../../manifest.json";

export const SettingPanel: React.FC<{
	setIsReloadingModel: React.Dispatch<React.SetStateAction<boolean>>;
	setReloadProgress: React.Dispatch<
		React.SetStateAction<{
			stage: string;
			progress: number;
		}>
	>;
	tooltipSide?: "top" | "right" | "bottom" | "left";
}> = ({ setIsReloadingModel, setReloadProgress, tooltipSide = "bottom" }) => {
	const navigate = useNavigate();
	const { theme, setTheme } = useTheme();
	const embeddingSize = useCurrentEmbeddingSize();
	const hasExistingData = useHasExistingData();
	const setEmbeddingSize = useEmbeddingSettings(
		(state) => state.setEmbeddingSize,
	);
	const { language, changeLanguage } = useLanguage();
	const { t } = useTranslation();
	const { user } = useAuth();
	const { signOut } = useAuthActions();
	const { state: copilotState, startTour } = useCopilot();

	const getThemeIcon = () => {
		switch (theme) {
			case "light":
				return <Sun size={16} />;
			case "dark":
				return <Moon size={16} />;
			case "system":
				return <Monitor size={16} />;
		}
	};

	const handleLogout = async () => {
		try {
			await signOut();
			navigate("/auth");
		} catch {
			// Ignore logout errors here; hook already manages error state
		}
	};

	const handleSettingsDropdownOpen = async (open: boolean) => {
		if (open) {
			// Refresh embedding size from offscreen when dropdown opens
			const currentSize = await getCurrentEmbeddingSize();
			const storeSize = useEmbeddingSettings.getState().embeddingSize;

			// Only update if different to avoid unnecessary re-renders
			if (currentSize !== storeSize) {
				useEmbeddingSettings.setState({ embeddingSize: currentSize });
			}
		}
	};

	const handleEmbeddingSizeChange = async (newSize: EmbeddingSize) => {
		if (hasExistingData && newSize !== embeddingSize) {
			// Embeddings are stored in per-size columns, so switching does not
			// delete anything — existing nodes/edges simply won't appear in
			// semantic recall at the new size until they are re-grown. Their data
			// is preserved and switching back to this size restores them.
			const confirmed = window.confirm(
				t("embedding.changeWarning", {
					defaultValue:
						"Changing the embedding size means memories you've already grown (nodes and edges) will stop appearing in semantic search until you re-grow them at the new size. Their data is kept, and switching back to the current size restores them. Continue?",
				}),
			);

			if (!confirmed) {
				return;
			}
		}

		// Update local state immediately
		await setEmbeddingSize(newSize);

		// Send reload job to offscreen thread to reload embedding model
		setIsReloadingModel(true);
		setReloadProgress({ stage: "Initializing...", progress: 0 });

		try {
			// Execute reload job with streaming to get real-time progress
			const { stream } = await backgroundJob.execute(
				"reload-embedding-model",
				{ newSize },
				{ stream: true },
			);

			// Stream progress updates
			for await (const progressEvent of stream) {
				if (progressEvent.progress !== undefined) {
					setReloadProgress({
						stage: progressEvent.stage || "Processing...",
						progress: progressEvent.progress,
					});
				}

				if (progressEvent.status === "failed") {
					throw new Error(progressEvent.error || "Job failed");
				}
			}

			logInfo(`✅ Embedding model reloaded to ${newSize}`);
			setIsReloadingModel(false);
		} catch (error) {
			logError("Failed to reload embedding model:", error);
			setIsReloadingModel(false);
			alert(
				t("embedding.reloadError", {
					defaultValue:
						"Failed to reload embedding model. Please refresh the page.",
				}),
			);
		}
	};

	return (
		<TooltipProvider>
			{/* Settings Menu */}
			<DropdownMenu onOpenChange={handleSettingsDropdownOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<button className="text-muted-foreground hover:text-foreground hover:bg-muted/50 p-2 text-sm font-medium flex items-center rounded-md transition-all duration-200 ease-in-out">
								<Settings size={16} />
							</button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side={tooltipSide}>
						<p>{t("common.settings")}</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end" className="w-56">
					{/* Account Section - Top */}
					{!user ? (
						<div className="p-2">
							<button
								disabled={!MANAGED_SERVICE_ENABLED}
								onClick={() => MANAGED_SERVICE_ENABLED && navigate("/auth")}
								className={cn(
									"w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-md font-medium transition-colors",
									MANAGED_SERVICE_ENABLED
										? "hover:bg-primary/90 cursor-pointer"
										: "opacity-50 cursor-not-allowed",
								)}
							>
								<LogIn size={16} />
								<span>{t("auth:actions.signIn")}</span>
							</button>
						</div>
					) : (
						<div className="px-2 py-1.5 flex items-center gap-2">
							<UserIcon size={14} className="text-muted-foreground" />
							<span className="text-sm truncate flex-1">{user.email}</span>
						</div>
					)}

					<DropdownMenuSeparator />

					{!copilotState.isActive ? (
						<>
							<DropdownMenuItem
								onClick={() => startTour()}
								className="flex items-center gap-2 cursor-pointer"
							>
								<HelpCircle size={14} />
								<span>{t("copilot.menuTitle")}</span>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					) : null}

					{/* Language Section */}
					<DropdownMenuLabel className="flex items-center gap-2">
						<Languages size={14} />
						<span>{t("language.label")}</span>
					</DropdownMenuLabel>
					<DropdownMenuItem
						onClick={() => changeLanguage("en")}
						className="flex items-center gap-2 cursor-pointer"
					>
						<USFlag className="flex-shrink-0" width={16} height={12} />
						<span>{t("language.english")}</span>
						{language === "en" && <span className="ml-auto">✓</span>}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => changeLanguage("vn")}
						className="flex items-center gap-2 cursor-pointer"
					>
						<VietnamFlag className="flex-shrink-0" width={16} height={12} />
						<span>{t("language.vietnamese")}</span>
						{language === "vn" && <span className="ml-auto">✓</span>}
					</DropdownMenuItem>

					<DropdownMenuSeparator />

					{/* Embedding Size Section */}
					<DropdownMenuLabel className="flex items-center gap-2">
						<VectorSquareIcon size={14} />
						<span>
							{t("embedding.label", {
								defaultValue: "Embedding Size",
							})}
						</span>
					</DropdownMenuLabel>
					{getAvailableSizes().map((size) => {
						const config = EMBEDDING_MODELS[size];
						const isDisabled = size === "large";
						return (
							<DropdownMenuItem
								key={size}
								disabled={isDisabled}
								onClick={() => !isDisabled && handleEmbeddingSizeChange(size)}
								className="flex flex-col items-start gap-0.5 cursor-pointer"
							>
								<div className="flex items-center gap-2 w-full">
									<span className="font-medium">{config.displayName}</span>
									{embeddingSize === size && <span className="ml-auto">✓</span>}
								</div>
								<span className="text-xs text-muted-foreground">
									{config.description}
								</span>
							</DropdownMenuItem>
						);
					})}

					<DropdownMenuSeparator />

					{/* Theme Section */}
					<DropdownMenuLabel className="flex items-center gap-2">
						{getThemeIcon()}
						<span>{t("theme.label")}</span>
					</DropdownMenuLabel>
					<DropdownMenuItem
						onClick={() => setTheme("light")}
						className="flex items-center gap-2 cursor-pointer"
					>
						<Sun size={14} />
						<span>{t("theme.light")}</span>
						{theme === "light" && <span className="ml-auto">✓</span>}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => setTheme("dark")}
						className="flex items-center gap-2 cursor-pointer"
					>
						<Moon size={14} />
						<span>{t("theme.dark")}</span>
						{theme === "dark" && <span className="ml-auto">✓</span>}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => setTheme("system")}
						className="flex items-center gap-2 cursor-pointer"
					>
						<Monitor size={14} />
						<span>{t("theme.system")}</span>
						{theme === "system" && <span className="ml-auto">✓</span>}
					</DropdownMenuItem>

					<DropdownMenuSeparator />

					{/* Logout (only when logged in) */}
					{user && (
						<DropdownMenuItem
							onClick={handleLogout}
							className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
						>
							<LogOut size={14} />
							<span>{t("auth:actions.signOut")}</span>
						</DropdownMenuItem>
					)}

					<div className="px-2 py-1.5 text-xs text-muted-foreground text-center">
						{t("common.version", { version: manifest.version })}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	);
};
