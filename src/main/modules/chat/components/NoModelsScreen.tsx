import React from "react";
import {
	LogIn,
	Cpu,
	KeyRound,
	Sparkles,
	Download,
	Settings,
	Wand2,
	Zap,
	Gift,
	Sliders,
} from "lucide-react";
import { AlertCircle, Loader2, CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { eq } from "drizzle-orm";
import { platform } from "@/platform/current";

import { cn } from "@/lib/utils";
import { hasLocalModelSupport } from "@/main/modules/llm/utils/browser-support";
import { Button } from "@/main/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import { YourModels } from "@/main/modules/llm/components/YourModels";
import { ExternalProvidersConfig } from "@/main/modules/llm/components/ExternalProvidersConfig";
import { MagicSetup } from "@/main/modules/llm/components/MagicSetup";
import { useAuth, useAuthActions } from "@/main/modules/supabase";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { MANAGED_SERVICE_ENABLED } from "@/constants/features";
import { useMagicModelDownload } from "@/main/modules/llm/hooks/use-magic-model-download";
import { useModelOperations } from "@/main/modules/llm/hooks/use-model-operations";
import { useDownloadedModels } from "@/main/modules/llm/hooks/use-downloaded-models";
import { useDownloadProgress } from "@/main/modules/llm/hooks/use-download-progress";
import { useCurrentModel } from "@/main/hooks/use-current-model";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";

const LOGO_URL = platform.assets.url("logo.png");

interface NoModelsScreenProps {
	onModelLoaded: (modelId: string, provider: ServiceProvider) => void;
	onNavigateToModels: () => void;
}

export const NoModelsScreen: React.FC<NoModelsScreenProps> = ({
	onModelLoaded,
	onNavigateToModels,
}) => {
	const { t } = useTranslation("chat");
	const { t: tLlm } = useTranslation("llm");
	const { isLoading, isInitialized } = useAuth();
	const canRunLocalModels = hasLocalModelSupport();
	const [selectedOption, setSelectedOption] = React.useState<
		"login" | "local" | "keys" | null
	>(null);
	const [authMode, setAuthMode] = React.useState<"signin" | "signup">("signin");
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [isSubmitting, setIsSubmitting] = React.useState(false);
	const [authError, setAuthError] = React.useState<string | null>(null);
	const [successMessage, setSuccessMessage] = React.useState<string | null>(
		null,
	);
	const { signIn, signUp } = useAuthActions();
	const { t: tAuth } = useTranslation("auth");
	const [localSetupMode, setLocalSetupMode] = React.useState<
		"magic" | "advanced" | null
	>(null);
	const [loading, setLoading] = React.useState(false);
	const [externalProviderConfigured, setExternalProviderConfigured] =
		React.useState<ServiceProvider | null>(null);
	const [defaultProvider, setDefaultProvider] = React.useState<
		"openai" | "openrouter" | undefined
	>(undefined);

	// Setup hooks for model operations
	const { setCurrent } = useCurrentModel();
	const { downloadedModels, fetchDownloadedModels } = useDownloadedModels();
	const { setDownloadProgress, setQuickDownloadModel } = useDownloadProgress();

	const { handleQuickDownload } = useModelOperations({
		setCurrent,
		setLoading,
		setQuickDownloadModel,
		setDownloadProgress,
		fetchDownloadedModels,
		downloadedModels,
		onModelLoaded,
	});

	// Check for existing provider configurations
	React.useEffect(() => {
		const checkExistingProviders = async () => {
			try {
				// Check OpenRouter first (prioritize if both exist)
				const openrouterConfig = await serviceManager.databaseService.use(
					({ db, schema }) => {
						return db
							.select()
							.from(schema.encryption)
							.where(eq(schema.encryption.key, "openrouter_config"));
					},
				);

				if (openrouterConfig && openrouterConfig.length > 0) {
					setDefaultProvider("openrouter");
					return;
				}

				// Check OpenAI
				const openaiConfig = await serviceManager.databaseService.use(
					({ db, schema }) => {
						return db
							.select()
							.from(schema.encryption)
							.where(eq(schema.encryption.key, "openai_config"));
					},
				);

				if (openaiConfig && openaiConfig.length > 0) {
					setDefaultProvider("openai");
					return;
				}
			} catch (error) {
				logError("Failed to check existing providers:", error);
			}
		};

		checkExistingProviders();
	}, []);

	// Handler for magic setup model selection
	const handleMagicModelSelected = useMagicModelDownload({
		handleQuickDownload,
	});

	// Auth handlers
	const handleSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		setAuthError(null);
		setSuccessMessage(null);

		if (!email.trim() || !password.trim()) {
			setAuthError(tAuth("errors.missingEmailOrPassword"));
			return;
		}

		try {
			setIsSubmitting(true);
			await signIn({
				email: email.trim(),
				password: password.trim(),
			});
			setSuccessMessage(tAuth("messages.signInSuccess"));
			// User will be redirected automatically when auth state changes
		} catch (err) {
			setAuthError(
				err instanceof Error ? err.message : tAuth("errors.signInFailed"),
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setAuthError(null);
		setSuccessMessage(null);

		if (!email.trim() || !password.trim()) {
			setAuthError(tAuth("errors.missingEmailOrPassword"));
			return;
		}

		if (password.length < 6) {
			setAuthError(tAuth("errors.passwordTooShort"));
			return;
		}

		try {
			setIsSubmitting(true);
			await signUp({
				email: email.trim(),
				password: password.trim(),
			});
			setSuccessMessage(tAuth("messages.accountCreated"));
			setAuthMode("signin");
		} catch (err) {
			setAuthError(
				err instanceof Error ? err.message : tAuth("errors.signUpFailed"),
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Handler for when external provider API key is configured
	const handleExternalProviderConfigured = (
		modelId: string,
		provider: ServiceProvider,
	) => {
		// When API key is configured, track the provider
		if (provider === "openai" || provider === "openrouter") {
			setExternalProviderConfigured(provider);
		}
		// Also call the parent's onModelLoaded
		onModelLoaded(modelId, provider);
	};

	// Reset states when changing options
	React.useEffect(() => {
		if (selectedOption !== "local") {
			setLocalSetupMode(null);
		}
		if (selectedOption !== "login") {
			setAuthMode("signin");
			setEmail("");
			setPassword("");
			setAuthError(null);
			setSuccessMessage(null);
		}
		if (selectedOption !== "keys") {
			setExternalProviderConfigured(null);
		}
	}, [selectedOption]);

	// Wait for auth to initialize
	if (!isInitialized || isLoading) {
		return (
			<div
				className="flex flex-col h-full bg-background"
				data-copilot="no-models-screen chat-center"
				data-agent-cursor-point="copilot-no-models-screen copilot-chat-center"
			>
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<img
							src={LOGO_URL}
							alt="Memorall Logo"
							className="w-12 h-12 mx-auto mb-4 object-contain animate-pulse"
						/>
						<p className="text-muted-foreground">{t("noModels.loading")}</p>
					</div>
				</div>
			</div>
		);
	}

	// Show no-models screen with 3 setup options
	return (
		<div
			className="flex flex-col h-full bg-background"
			data-copilot="no-models-screen chat-center"
			data-agent-cursor-point="copilot-no-models-screen copilot-chat-center"
		>
			<div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
				<div className="w-full max-w-6xl mx-auto space-y-8 py-8 max-h-full">
					{/* App Branding */}
					<div className="text-center space-y-4 animate-in fade-in-0 slide-in-from-top-3 duration-500 ease-out">
						<img
							src={LOGO_URL}
							alt="Memorall Logo"
							className="w-16 h-16 mx-auto object-contain transition-transform duration-300 ease-out hover:scale-110 hover:rotate-3"
						/>
						<div className="space-y-2">
							<h1 className="text-3xl font-bold">{t("noModels.appName")}</h1>
							<p className="text-lg text-muted-foreground">
								{tLlm("noModelsScreen.chooseSetup")}
							</p>
						</div>
					</div>

					{/* 3 Setup Cards - Responsive Grid */}
					{!selectedOption && (
						<div
							className="grid gap-6 max-w-5xl mx-auto"
							style={{
								gridTemplateColumns:
									"repeat(auto-fit, minmax(min(20rem, 100%), 1fr))",
							}}
						>
							{/* Card 1: Login/Signup */}
							<Card
								data-copilot="setup-managed"
								data-agent-cursor-point="copilot-setup-managed"
								className={cn(
									"group relative border-2 transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out animate-in fade-in-0 slide-in-from-bottom-4",
									!MANAGED_SERVICE_ENABLED
										? "cursor-not-allowed opacity-60"
										: "cursor-pointer hover:-translate-y-1 hover:scale-[1.01] hover:border-primary hover:shadow-xl hover:shadow-primary/10",
								)}
							>
								<Popover>
									<PopoverTrigger asChild>
										<div className="absolute top-3 right-3 cursor-help">
											<span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-200 hover:scale-105">
												<Zap className="w-3 h-3" />
												Easy
											</span>
										</div>
									</PopoverTrigger>
									<PopoverContent className="w-64" align="end">
										<div className="space-y-2">
											<h4 className="font-semibold text-sm">
												{tLlm("noModelsScreen.managedService.badge.title", {
													defaultValue: "Easy Setup",
												})}
											</h4>
											<p className="text-xs text-muted-foreground">
												{tLlm(
													"noModelsScreen.managedService.badge.description",
													{
														defaultValue:
															"Sign in and start chatting immediately. No configuration needed - we handle the infrastructure and model hosting for you.",
													},
												)}
											</p>
										</div>
									</PopoverContent>
								</Popover>
								<CardHeader className="text-center pb-4">
									<div className="mx-auto mb-4 p-4 rounded-full bg-primary/10 w-fit transition-[background-color,transform] duration-300 ease-out group-hover:scale-110 group-hover:bg-primary/20">
										<Sparkles className="w-8 h-8 text-primary transition-transform duration-300 ease-out group-hover:rotate-6" />
									</div>
									<CardTitle className="text-xl">
										{tLlm("noModelsScreen.managedService.title")}
									</CardTitle>
									<CardDescription className="text-sm">
										{tLlm("noModelsScreen.managedService.description")}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-3 text-sm">
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.managedService.feature1")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.managedService.feature2")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.managedService.feature3")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.managedService.feature4")}</p>
										</div>
									</div>
									<Button
										disabled={!MANAGED_SERVICE_ENABLED}
										className="w-full bg-primary transition-all duration-200 ease-out hover:bg-primary/90 hover:shadow-md hover:shadow-primary/20 active:scale-[0.98]"
										size="lg"
									>
										<LogIn className="w-4 h-4 mr-2" />
										{tLlm("noModelsScreen.managedService.action")}
									</Button>
								</CardContent>
							</Card>

							{/* Card 2: Local LLM */}
							<Card
								data-copilot="setup-local"
								data-agent-cursor-point="copilot-setup-local"
								data-local-models-unsupported={
									canRunLocalModels ? undefined : "true"
								}
								className={cn(
									"group relative border-2 transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out animate-in fade-in-0 slide-in-from-bottom-4 delay-100",
									canRunLocalModels
										? "cursor-pointer hover:-translate-y-1 hover:scale-[1.01] hover:border-primary hover:shadow-xl hover:shadow-emerald-500/10"
										: "cursor-not-allowed opacity-60",
								)}
							>
								<Popover>
									<PopoverTrigger asChild>
										<div className="absolute top-3 right-3 cursor-help z-10">
											<span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-200 hover:scale-105">
												<Gift className="w-3 h-3" />
												Free
											</span>
										</div>
									</PopoverTrigger>
									<PopoverContent className="w-64" align="end">
										<div className="space-y-2">
											<h4 className="font-semibold text-sm">
												{tLlm("noModelsScreen.localModels.badge.title", {
													defaultValue: "Completely Free",
												})}
											</h4>
											<p className="text-xs text-muted-foreground">
												{tLlm("noModelsScreen.localModels.badge.description", {
													defaultValue:
														"Run AI models directly on your device. Zero API costs, complete privacy, and works offline. Your data never leaves your computer.",
												})}
											</p>
										</div>
									</PopoverContent>
								</Popover>
								<CardHeader className="text-center pb-4">
									<div className="mx-auto mb-4 p-4 rounded-full bg-emerald-500/10 w-fit transition-[background-color,transform] duration-300 ease-out group-hover:scale-110 group-hover:bg-emerald-500/20">
										<Cpu className="w-8 h-8 text-emerald-600 transition-transform duration-300 ease-out group-hover:rotate-6 dark:text-emerald-500" />
									</div>
									<CardTitle className="text-xl">
										{tLlm("noModelsScreen.localModels.title")}
									</CardTitle>
									<CardDescription className="text-sm">
										{tLlm("noModelsScreen.localModels.description")}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-3 text-sm">
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.localModels.feature1")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.localModels.feature2")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.localModels.feature3")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.localModels.feature4")}</p>
										</div>
									</div>
									{canRunLocalModels ? null : (
										<p className="mb-3 text-xs text-amber-600 dark:text-amber-500">
											{tLlm("browserSupport.noLocalProviders")}
										</p>
									)}
									<TooltipProvider>
										<div className="flex gap-2">
											{/* Magic Setup Button - Primary */}
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														onClick={() => {
															setSelectedOption("local");
															setLocalSetupMode("magic");
														}}
														disabled={!canRunLocalModels}
														className="flex-1 bg-emerald-600 transition-all duration-200 ease-out hover:bg-emerald-700 hover:shadow-md hover:shadow-emerald-500/20 active:scale-[0.98] dark:bg-emerald-600 dark:hover:bg-emerald-700"
														size="lg"
													>
														<Wand2 className="w-4 h-4 mr-2" />
														{tLlm("noModelsScreen.localModels.magicAction")}
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													<p className="max-w-xs">
														{canRunLocalModels
															? tLlm("noModelsScreen.localModels.magicTooltip")
															: tLlm("browserSupport.noLocalProviders")}
													</p>
												</TooltipContent>
											</Tooltip>

											{/* Advanced Setup Button - Secondary */}
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														onClick={() => {
															setSelectedOption("local");
															setLocalSetupMode("advanced");
														}}
														disabled={!canRunLocalModels}
														variant="outline"
														size="lg"
														className="px-3 transition-all duration-200 ease-out hover:scale-105 active:scale-95"
													>
														<Settings className="w-4 h-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													<p className="max-w-xs">
														{canRunLocalModels
															? tLlm(
																	"noModelsScreen.localModels.advancedTooltip",
																)
															: tLlm("browserSupport.noLocalProviders")}
													</p>
												</TooltipContent>
											</Tooltip>
										</div>
									</TooltipProvider>
								</CardContent>
							</Card>

							{/* Card 3: Own Keys */}
							<Card
								data-copilot="setup-keys"
								data-agent-cursor-point="copilot-setup-keys"
								className="group relative cursor-pointer border-2 transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out animate-in fade-in-0 slide-in-from-bottom-4 delay-200 hover:-translate-y-1 hover:scale-[1.01] hover:border-primary hover:shadow-xl hover:shadow-amber-500/10"
							>
								<Popover>
									<PopoverTrigger asChild>
										<div className="absolute top-3 right-3 cursor-help z-10">
											<span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/20 hover:shadow-xl hover:shadow-amber-500/30 transition-all duration-200 hover:scale-105">
												<Sliders className="w-3 h-3" />
												Control
											</span>
										</div>
									</PopoverTrigger>
									<PopoverContent className="w-64" align="end">
										<div className="space-y-2">
											<h4 className="font-semibold text-sm">
												{tLlm("noModelsScreen.ownKeys.badge.title", {
													defaultValue: "Full Control",
												})}
											</h4>
											<p className="text-xs text-muted-foreground">
												{tLlm("noModelsScreen.ownKeys.badge.description", {
													defaultValue:
														"Use your own API keys from OpenAI or OpenRouter. You control your spending limits, choose your models, and manage your own billing.",
												})}
											</p>
										</div>
									</PopoverContent>
								</Popover>
								<CardHeader className="text-center pb-4">
									<div className="mx-auto mb-4 p-4 rounded-full bg-amber-500/10 w-fit transition-[background-color,transform] duration-300 ease-out group-hover:scale-110 group-hover:bg-amber-500/20">
										<KeyRound className="w-8 h-8 text-amber-600 transition-transform duration-300 ease-out group-hover:rotate-6 dark:text-amber-500" />
									</div>
									<CardTitle className="text-xl">
										{tLlm("noModelsScreen.ownKeys.title")}
									</CardTitle>
									<CardDescription className="text-sm">
										{tLlm("noModelsScreen.ownKeys.description")}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-3 text-sm">
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.ownKeys.feature1")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.ownKeys.feature2")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.ownKeys.feature3")}</p>
										</div>
										<div className="flex items-start gap-2">
											<div className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 mt-1.5 flex-shrink-0" />
											<p>{tLlm("noModelsScreen.ownKeys.feature4")}</p>
										</div>
									</div>
									<Button
										onClick={() => setSelectedOption("keys")}
										className="w-full bg-amber-600 transition-all duration-200 ease-out hover:bg-amber-700 hover:shadow-md hover:shadow-amber-500/20 active:scale-[0.98] dark:bg-amber-600 dark:hover:bg-amber-700"
										size="lg"
									>
										<Settings className="w-4 h-4 mr-2" />
										{tLlm("noModelsScreen.ownKeys.action")}
									</Button>
								</CardContent>
							</Card>
						</div>
					)}

					{/* Local Models Setup */}
					{selectedOption === "local" && (
						<div className="max-w-4xl mx-auto space-y-6 animate-in fade-in-0 slide-in-from-bottom-3 duration-300 ease-out">
							<div className="flex items-center justify-between">
								<div>
									<h2 className="text-2xl font-semibold">
										{localSetupMode === "magic"
											? tLlm("noModelsScreen.localModels.magicSetupTitle")
											: tLlm("noModelsScreen.localModels.advancedSetupTitle")}
									</h2>
									<p className="text-sm text-muted-foreground">
										{localSetupMode === "magic"
											? tLlm("noModelsScreen.localModels.magicSetupDescription")
											: tLlm(
													"noModelsScreen.localModels.advancedSetupDescription",
												)}
									</p>
								</div>
								<Button
									variant="outline"
									onClick={() => setSelectedOption(null)}
								>
									{tLlm("noModelsScreen.back")}
								</Button>
							</div>

							{/* Magic Setup Flow */}
							{localSetupMode === "magic" && (
								<MagicSetup
									onModelSelected={handleMagicModelSelected}
									onCancel={() => setLocalSetupMode("advanced")}
								/>
							)}

							{/* Advanced Setup Flow */}
							{localSetupMode === "advanced" && (
								<YourModels
									onModelLoaded={onModelLoaded}
									showQuickDownload={true}
									allowedProviders={[
										"transformer",
										"wllama",
										"webllm",
										"lmstudio",
										"ollama",
									]}
								/>
							)}
						</div>
					)}

					{/* Login/Signup Setup */}
					{selectedOption === "login" && (
						<div className="max-w-md mx-auto space-y-4 animate-in fade-in-0 slide-in-from-bottom-3 duration-300 ease-out">
							<div className="flex items-center justify-between">
								<div>
									<h2 className="text-2xl font-semibold">
										{authMode === "signin"
											? tAuth("titles.signIn")
											: tAuth("titles.signUp")}
									</h2>
									<p className="text-sm text-muted-foreground">
										{authMode === "signin"
											? tAuth("descriptions.signIn")
											: tAuth("descriptions.signUp")}
									</p>
								</div>
								<Button
									variant="outline"
									onClick={() => setSelectedOption(null)}
								>
									{tLlm("noModelsScreen.back")}
								</Button>
							</div>

							<Card>
								<CardContent className="pt-6">
									{authError && (
										<div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-2">
											<AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
											<p className="text-sm text-destructive">{authError}</p>
										</div>
									)}

									{successMessage && (
										<div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-md flex items-start gap-2">
											<CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
											<p className="text-sm text-green-600 dark:text-green-400">
												{successMessage}
											</p>
										</div>
									)}

									{authMode === "signin" && (
										<form onSubmit={handleSignIn} className="space-y-4">
											<div className="space-y-2">
												<Label htmlFor="email">
													{tAuth("fields.email.label")}
												</Label>
												<Input
													id="email"
													type="email"
													placeholder={tAuth("fields.email.placeholder")}
													value={email}
													onChange={(e) => setEmail(e.target.value)}
													disabled={isSubmitting}
													required
												/>
											</div>
											<div className="space-y-2">
												<Label htmlFor="password">
													{tAuth("fields.password.label")}
												</Label>
												<Input
													id="password"
													type="password"
													placeholder={tAuth("fields.password.placeholder")}
													value={password}
													onChange={(e) => setPassword(e.target.value)}
													disabled={isSubmitting}
													required
												/>
											</div>
											<Button
												type="submit"
												className="w-full"
												disabled={isSubmitting}
											>
												{isSubmitting ? (
													<>
														<Loader2 className="mr-2 h-4 w-4 animate-spin" />
														{tAuth("actions.signingIn")}
													</>
												) : (
													tAuth("actions.signIn")
												)}
											</Button>
										</form>
									)}

									{authMode === "signup" && (
										<form onSubmit={handleSignUp} className="space-y-4">
											<div className="space-y-2">
												<Label htmlFor="signup-email">
													{tAuth("fields.email.label")}
												</Label>
												<Input
													id="signup-email"
													type="email"
													placeholder={tAuth("fields.email.placeholder")}
													value={email}
													onChange={(e) => setEmail(e.target.value)}
													disabled={isSubmitting}
													required
												/>
											</div>
											<div className="space-y-2">
												<Label htmlFor="signup-password">
													{tAuth("fields.password.label")}
												</Label>
												<Input
													id="signup-password"
													type="password"
													placeholder={tAuth(
														"fields.password.signupPlaceholder",
													)}
													value={password}
													onChange={(e) => setPassword(e.target.value)}
													disabled={isSubmitting}
													required
													minLength={6}
												/>
											</div>
											<Button
												type="submit"
												className="w-full"
												disabled={isSubmitting}
											>
												{isSubmitting ? (
													<>
														<Loader2 className="mr-2 h-4 w-4 animate-spin" />
														{tAuth("actions.creatingAccount")}
													</>
												) : (
													tAuth("actions.signUp")
												)}
											</Button>
										</form>
									)}

									<div className="mt-4 space-y-2">
										{authMode === "signin" && (
											<Button
												variant="ghost"
												className="w-full"
												onClick={() => setAuthMode("signup")}
												disabled={isSubmitting}
											>
												{tAuth("actions.goToSignUp")}
											</Button>
										)}

										{authMode === "signup" && (
											<Button
												variant="ghost"
												className="w-full"
												onClick={() => setAuthMode("signin")}
												disabled={isSubmitting}
											>
												{tAuth("actions.goToSignIn")}
											</Button>
										)}

										<div className="w-full border-t my-2" />

										<Button
											variant="outline"
											className="w-full"
											onClick={() => setSelectedOption(null)}
											disabled={isSubmitting}
										>
											{tAuth("actions.skipLocalOnly")}
										</Button>
									</div>
								</CardContent>
							</Card>
						</div>
					)}

					{/* API Keys Setup */}
					{selectedOption === "keys" && (
						<div className="max-w-4xl mx-auto space-y-4 animate-in fade-in-0 slide-in-from-bottom-3 duration-300 ease-out">
							<div className="flex items-center justify-between">
								<div>
									<h2 className="text-2xl font-semibold">
										{externalProviderConfigured
											? tLlm("yourModels.title")
											: tLlm("noModelsScreen.ownKeys.setupTitle")}
									</h2>
									<p className="text-sm text-muted-foreground">
										{externalProviderConfigured
											? tLlm("yourModels.description")
											: tLlm("noModelsScreen.ownKeys.setupDescription")}
									</p>
								</div>
								<Button
									variant="outline"
									onClick={() => {
										if (externalProviderConfigured) {
											setExternalProviderConfigured(null);
										} else {
											setSelectedOption(null);
										}
									}}
								>
									{tLlm("noModelsScreen.back")}
								</Button>
							</div>

							{/* Show API key configuration if not configured yet */}
							{!externalProviderConfigured && (
								<ExternalProvidersConfig
									onModelLoaded={handleExternalProviderConfigured}
									defaultProvider={defaultProvider}
								/>
							)}

							{/* Show models list after configuration */}
							{externalProviderConfigured && (
								<YourModels
									onModelLoaded={onModelLoaded}
									showQuickDownload={false}
								/>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
