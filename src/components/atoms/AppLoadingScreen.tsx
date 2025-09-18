import React, { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { TextGenerateEffect } from "../ui/shadcn-io/text-generate-effect";
import { Progress } from "../ui/progress";
import {
	Brain,
	Database,
	Zap,
	MessageSquare,
	CheckCircle2,
	Loader2,
} from "lucide-react";
import {
	serviceManager,
} from "@/services";
import type { InitializationProgress } from "@/services/ServiceManager";

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

const LOADING_STEPS: LoadingStep[] = [
	{
		id: "database",
		icon: <Database className="w-4 h-4" />,
		title: "Database Setup",
		description: "Setting up knowledge graph database with vector extensions",
		duration: 2000,
	},
	{
		id: "embedding",
		icon: <Brain className="w-4 h-4" />,
		title: "Embedding Models",
		description: "Loading embedding models for semantic search",
		duration: 3000,
	},
	{
		id: "llm",
		icon: <Zap className="w-4 h-4" />,
		title: "LLM Service",
		description: "Initializing local LLM inference service",
		duration: 2500,
	},
	{
		id: "interface",
		icon: <MessageSquare className="w-4 h-4" />,
		title: "Interface Ready",
		description: "Preparing chat interface and model management",
		duration: 1500,
	},
];

export const AppLoadingScreen: React.FC<AppLoadingScreenProps> = ({
	error,
	onRetry,
	uiProgress = 0,
}) => {
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

	if (error) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background px-4">
				<Card className="w-[480px] border-destructive">
					<CardContent className="p-6">
						<div className="text-center">
							<div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
								<div className="text-destructive text-2xl">❌</div>
							</div>
							<h2 className="text-xl font-semibold text-foreground mb-2">
								Service Initialization Failed
							</h2>
							<p className="text-sm text-muted-foreground mb-6 break-words">
								{error}
							</p>
							<div className="space-y-3">
								<button
									onClick={onRetry}
									className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
								>
									Try Again
								</button>
								<p className="text-xs text-muted-foreground">
									If the problem persists, check your browser console for more
									details.
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="min-h-screen flex items-center justify-center bg-background px-4">
			<Card className="w-[520px] border-0 shadow-xl">
				<CardContent className="p-8">
					<div className="text-center">
						{/* Header with animated title */}
						<div className="mb-8">
							<div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
								<Brain className="w-8 h-8 text-primary-foreground animate-pulse" />
							</div>
							<TextGenerateEffect
								words="Initializing Memorall..."
								duration={0.6}
								staggerDelay={0.1}
								className="text-2xl font-bold text-foreground mb-2"
								filter={true}
							/>
							<p className="text-sm text-muted-foreground">
								Setting up your AI-powered knowledge assistant
							</p>
						</div>

						{/* Progress bar */}
						<div className="mb-6">
							<div className="flex justify-between items-center mb-2">
								<span className="text-sm font-medium text-foreground">
									{serviceProgress.step}
								</span>
								<span className="text-sm text-muted-foreground">
									{Math.round(uiProgress || serviceProgress.progress)}%
								</span>
							</div>
							<Progress
								value={uiProgress || serviceProgress.progress}
								className="h-2 transition-all duration-300"
							/>
						</div>

						{/* Loading steps */}
						<div className="space-y-3 text-left">
							{LOADING_STEPS.map((step) => {
								const { isCompleted, isCurrent } = getStepStatus(step.id);

								return (
									<div
										key={step.id}
										className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
											isCompleted
												? "bg-green-50 dark:bg-green-950/20"
												: isCurrent
													? "bg-primary/5 border border-primary/20"
													: "bg-muted/30"
										}`}
									>
										<div
											className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
												isCompleted
													? "bg-green-500 text-white"
													: isCurrent
														? "bg-primary text-primary-foreground"
														: "bg-muted text-muted-foreground"
											}`}
										>
											{isCompleted ? (
												<CheckCircle2 className="w-4 h-4" />
											) : isCurrent ? (
												<Loader2 className="w-4 h-4 animate-spin" />
											) : (
												step.icon
											)}
										</div>
										<div className="flex-1 min-w-0">
											<div
												className={`font-medium text-sm transition-colors ${
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
												className={`text-xs transition-colors ${
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
											<div className="text-xs text-green-600 dark:text-green-400 font-medium">
												✓ Done
											</div>
										)}
									</div>
								);
							})}
						</div>

						{/* Footer info */}
						<div className="mt-8 pt-6 border-t border-border">
							<div className="flex justify-between items-center text-xs text-muted-foreground">
								<span>Elapsed: {formatElapsedTime(elapsedTime)}</span>
								<span>This may take a moment on first launch...</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
};
