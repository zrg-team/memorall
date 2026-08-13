import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "../ui/card";
import { Progress } from "../ui/progress";
import {
	Brain,
	Database,
	Zap,
	MessageSquare,
	CheckCircle2,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { serviceManager } from "@/services";
import type { InitializationProgress } from "@/services/service-manager";
import TypingText from "../ui/shadcn-io/typing-text";
import { RUNTIME_PANEL_BREAKPOINT } from "@/utils/dom";
import { platform } from "@/platform/current";

const LOGO_URL = platform.assets.url("logo.png");

interface LoadingStep {
	id: string;
	icon: React.ReactNode;
	title: string;
	description: string;
	duration: number; // estimated duration in ms
}

interface AppLoadingScreenProps {
	error?: string | null;
	onRetry?: () => void;
	uiProgress?: number;
}

// Loading steps will be created inside component to access translations
const LOADING_STEP_ICONS = {
	database: <Database className="w-4 h-4" />,
	embedding: <Brain className="w-4 h-4" />,
	llm: <Zap className="w-4 h-4" />,
	interface: <MessageSquare className="w-4 h-4" />,
} as const;

const LOADING_STEP_DURATIONS = {
	database: 2000,
	embedding: 3000,
	llm: 2500,
	interface: 1500,
} as const;

export const AppLoadingScreen: React.FC<AppLoadingScreenProps> = ({
	error,
	onRetry,
	uiProgress = 0,
}) => {
	const { t } = useTranslation("common");
	const isPopup = window.innerWidth < RUNTIME_PANEL_BREAKPOINT;

	// Create loading steps with translations
	const LOADING_STEPS: LoadingStep[] = [
		{
			id: "database",
			icon: LOADING_STEP_ICONS.database,
			title: t("appLoading.steps.database.title"),
			description: t("appLoading.steps.database.description"),
			duration: LOADING_STEP_DURATIONS.database,
		},
		{
			id: "embedding",
			icon: LOADING_STEP_ICONS.embedding,
			title: t("appLoading.steps.embedding.title"),
			description: t("appLoading.steps.embedding.description"),
			duration: LOADING_STEP_DURATIONS.embedding,
		},
		{
			id: "llm",
			icon: LOADING_STEP_ICONS.llm,
			title: t("appLoading.steps.llm.title"),
			description: t("appLoading.steps.llm.description"),
			duration: LOADING_STEP_DURATIONS.llm,
		},
		{
			id: "interface",
			icon: LOADING_STEP_ICONS.interface,
			title: t("appLoading.steps.interface.title"),
			description: t("appLoading.steps.interface.description"),
			duration: LOADING_STEP_DURATIONS.interface,
		},
	];

	const [serviceProgress, setServiceProgress] =
		useState<InitializationProgress>({
			step: "Starting",
			progress: 0,
			isComplete: false,
		});
	const [elapsedTime, setElapsedTime] = useState(0);

	// Listen to real progress from ServiceManager
	useEffect(() => {
		if (error) return;

		const startTime = Date.now();

		// Update elapsed time
		const timeInterval = setInterval(() => {
			setElapsedTime(Date.now() - startTime);
		}, 100);

		// Listen to ServiceManager progress
		const unsubscribe = serviceManager.onProgressChange((progress) => {
			setServiceProgress(progress);
		});

		return () => {
			clearInterval(timeInterval);
			unsubscribe();
		};
	}, [error]);

	// Step status based on UX progress ranges
	const getStepStatus = (stepId: string) => {
		const progressToUse = uiProgress || serviceProgress.progress;

		switch (stepId) {
			case "database":
				return {
					isCompleted: progressToUse >= 5,
					isCurrent: progressToUse >= 0 && progressToUse < 5,
				};
			case "embedding":
				return {
					isCompleted: progressToUse >= 95,
					isCurrent: progressToUse >= 5 && progressToUse < 95,
				};
			case "llm":
				return {
					isCompleted: progressToUse >= 100,
					isCurrent: progressToUse >= 95 && progressToUse < 100,
				};
			case "interface":
				return {
					isCompleted: progressToUse >= 100,
					isCurrent: false, // Interface is instant when LLM completes
				};
			default:
				return { isCompleted: false, isCurrent: false };
		}
	};

	// Format elapsed time
	const formatElapsedTime = (ms: number) => {
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	};

	const progressToUse = Math.round(uiProgress || serviceProgress.progress);

	if (error) {
		if (isPopup) {
			return (
				<div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 bg-background px-5 py-6 text-center">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
						<img
							src={LOGO_URL}
							alt="Memorall Logo"
							className="h-9 w-9 object-contain opacity-50"
						/>
					</div>
					<div>
						<p className="text-sm font-semibold text-foreground">
							{t("appLoading.error.title")}
						</p>
						<p className="mt-1 text-xs text-muted-foreground break-words">
							{error}
						</p>
					</div>
					<button
						onClick={onRetry}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						{t("appLoading.error.tryAgain")}
					</button>
					<p className="text-[11px] text-muted-foreground">
						{t("appLoading.error.consoleHelp")}
					</p>
				</div>
			);
		}

		return (
			<div className="flex min-h-dvh items-center justify-center bg-background px-3 py-4 sm:px-4">
				<Card className="w-full max-w-[480px] border-destructive">
					<CardContent className="p-4 sm:p-6">
						<div className="text-center">
							<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-destructive/10 sm:h-16 sm:w-16">
								<img
									src={LOGO_URL}
									alt="Memorall Logo"
									className="h-12 w-12 object-contain opacity-50 sm:h-14 sm:w-14"
								/>
							</div>
							<h2 className="mb-2 text-xl font-semibold text-foreground">
								{t("appLoading.error.title")}
							</h2>
							<p className="mb-6 break-words text-sm text-muted-foreground">
								{error}
							</p>
							<div className="space-y-3">
								<button
									onClick={onRetry}
									className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
								>
									<RefreshCw className="h-4 w-4" />
									{t("appLoading.error.tryAgain")}
								</button>
								<p className="text-xs text-muted-foreground">
									{t("appLoading.error.consoleHelp")}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (isPopup) {
		return (
			<div className="flex h-dvh flex-col justify-center bg-background overflow-y-auto px-4 py-6">
				<div className="mx-auto w-full max-w-sm">
					{/* Logo + title row */}
					<div className="flex items-center gap-3 mb-6">
						<img
							src={LOGO_URL}
							alt="Memorall Logo"
							className="h-10 w-10 shrink-0 object-contain"
						/>
						<div className="min-w-0">
							<p className="text-sm font-semibold text-foreground leading-tight">
								{t("appLoading.title")}
							</p>
							<p className="text-[11px] text-muted-foreground">
								{t("appLoading.subtitle")}
							</p>
						</div>
						<div className="ml-auto shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground">
							<Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
							<span>{progressToUse}%</span>
						</div>
					</div>

					{/* Progress bar */}
					<Progress
						value={progressToUse}
						className="h-1.5 rounded-full mb-1.5"
					/>
					<div className="flex justify-between text-[11px] text-muted-foreground mb-6">
						<span className="truncate">{serviceProgress.step}</span>
						<span className="shrink-0 pl-2">
							{t("appLoading.elapsed", {
								time: formatElapsedTime(elapsedTime),
							})}
						</span>
					</div>

					{/* Steps checklist */}
					<div className="flex flex-col gap-2">
						{LOADING_STEPS.map((step) => {
							const { isCompleted, isCurrent } = getStepStatus(step.id);
							return (
								<div
									key={step.id}
									className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-300 ${
										isCompleted
											? "bg-emerald-500/10"
											: isCurrent
												? "bg-primary/8 border border-primary/20"
												: "bg-muted/20"
									}`}
								>
									<div
										className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all duration-300 ${
											isCompleted
												? "bg-emerald-500 text-white"
												: isCurrent
													? "bg-primary text-primary-foreground"
													: "bg-muted/60 text-muted-foreground"
										}`}
									>
										{isCompleted ? (
											<CheckCircle2 className="h-3.5 w-3.5" />
										) : isCurrent ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										) : (
											<span className="scale-75">{step.icon}</span>
										)}
									</div>
									<div className="min-w-0 flex-1">
										<p
											className={`text-xs font-medium truncate ${
												isCompleted
													? "text-emerald-400"
													: isCurrent
														? "text-foreground"
														: "text-muted-foreground"
											}`}
										>
											{step.title}
										</p>
										<p className="text-[11px] text-muted-foreground truncate">
											{step.description}
										</p>
									</div>
									{isCompleted && (
										<span className="shrink-0 text-[11px] font-medium text-emerald-400">
											{t("appLoading.done")}
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-dvh items-center justify-center bg-background px-3 py-4 sm:px-4">
			<Card className="w-full max-w-[520px] border-0 shadow-xl">
				<CardContent className="p-4 sm:p-8">
					<div className="text-center">
						{/* Header with animated title */}
						<div className="mb-5 sm:mb-8">
							<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-primary/60 sm:h-20 sm:w-20">
								<img
									src={LOGO_URL}
									alt="Memorall Logo"
									className="h-12 w-12 object-contain sm:h-14 sm:w-14"
								/>
							</div>
							<TypingText
								text={[
									t("appLoading.title"),
									t("appLoading.subtitle"),
									...(t("appLoading.taglines", {
										returnObjects: true,
									}) as string[]),
								]}
								typingSpeed={60}
								pauseDuration={200}
								showCursor={true}
								cursorCharacter="|"
								className="break-words text-2xl font-bold leading-tight sm:text-4xl"
								textColors={["#3b82f6", "#8b5cf6", "#06b6d4"]}
								variableSpeed={{ min: 50, max: 120 }}
							/>
							<p className="text-sm text-muted-foreground">
								{t("appLoading.subtitle")}
							</p>
						</div>

						{/* Progress bar */}
						<div className="mb-5 sm:mb-6">
							<div className="flex justify-between items-center mb-2">
								<span className="text-sm font-medium text-foreground">
									{serviceProgress.step}
								</span>
								<span className="text-sm text-muted-foreground">
									{progressToUse}%
								</span>
							</div>
							<Progress
								value={progressToUse}
								className="h-2 transition-all duration-300"
							/>
						</div>

						{/* Loading steps */}
						<div className="space-y-2 text-left sm:space-y-3">
							{LOADING_STEPS.map((step) => {
								const { isCompleted, isCurrent } = getStepStatus(step.id);

								return (
									<div
										key={step.id}
										className={`flex items-center gap-2.5 rounded-lg p-2.5 transition-all duration-300 sm:gap-3 sm:p-3 ${
											isCompleted
												? "bg-green-50 dark:bg-green-950/20"
												: isCurrent
													? "bg-primary/5 border border-primary/20"
													: "bg-muted/30"
										}`}
									>
										<div
											className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-all duration-300 sm:h-8 sm:w-8 ${
												isCompleted
													? "bg-green-500 text-white"
													: isCurrent
														? "bg-primary text-primary-foreground"
														: "bg-muted text-muted-foreground"
											}`}
										>
											{isCompleted ? (
												<CheckCircle2 className="h-4 w-4" />
											) : isCurrent ? (
												<Loader2 className="h-4 w-4 animate-spin" />
											) : (
												step.icon
											)}
										</div>
										<div className="min-w-0 flex-1">
											<div
												className={`truncate text-sm font-medium transition-colors ${
													isCompleted
														? "text-green-700 dark:text-green-300"
														: isCurrent
															? "text-foreground"
															: "text-muted-foreground"
												}`}
											>
												{step.title}
											</div>
											<div
												className={`line-clamp-2 text-xs transition-colors ${
													isCompleted
														? "text-green-600 dark:text-green-400"
														: isCurrent
															? "text-foreground/80"
															: "text-muted-foreground/80"
												}`}
											>
												{step.description}
											</div>
										</div>
										{isCompleted && (
											<div className="shrink-0 text-xs font-medium text-green-600 dark:text-green-400">
												{t("appLoading.done")}
											</div>
										)}
									</div>
								);
							})}
						</div>

						{/* Footer info */}
						<div className="mt-5 border-t border-border pt-4 sm:mt-8 sm:pt-6">
							<div className="flex flex-col gap-1 text-xs text-muted-foreground min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
								<span>
									{t("appLoading.elapsed", {
										time: formatElapsedTime(elapsedTime),
									})}
								</span>
								<span>{t("appLoading.firstLaunch")}</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
};
