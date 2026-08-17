import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	Loader2,
	Cpu,
	MemoryStick,
	Zap,
	Sparkles,
	FileText,
	CheckCircle2,
	AlertCircle,
	Scale,
	Search,
	HardDrive,
	Info,
	type LucideIcon,
} from "lucide-react";

import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/main/components/ui/card";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Badge } from "@/main/components/ui/badge";
import { backgroundJob } from "@/services/background-jobs/background-job";
import {
	MODEL_PREFERENCES,
	generateAllRecommendations,
} from "../utils/model-recommendations";
import type {
	SystemSpecs,
	ModelPreference,
	RecommendationSet,
	ModelRecommendation,
} from "../types/system-specs";
import {
	getAvailableModelMemoryGB,
	estimateModelMemory,
	estimateModelMemoryAtUsableContext,
	type ModelMemoryEstimate,
} from "../utils/model-memory";
import type { ModelAbilities } from "@/services/llm/interfaces/llm-model-config";

function fmtGB(gb: number): string {
	return gb < 1 ? `${(gb * 1024).toFixed(0)} MB` : `${gb.toFixed(1)} GB`;
}

function fmtCtx(tokens: number): string {
	if (tokens <= 0) return "0";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	return `${Math.round(tokens / 1024)}K`;
}

// ─── Small reusable UI pieces ────────────────────────────────────────────────

const MemoryBar: React.FC<{
	usedGB: number;
	availableGB: number;
	className?: string;
}> = ({ usedGB, availableGB, className = "" }) => {
	const pct = Math.min(100, (usedGB / availableGB) * 100);
	const color =
		pct < 70 ? "bg-green-500" : pct < 95 ? "bg-yellow-500" : "bg-red-500";
	return (
		<div
			className={`h-1.5 w-full bg-muted rounded-full overflow-hidden ${className}`}
		>
			<div
				className={`h-full ${color} rounded-full transition-all duration-300`}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
};

const FitBadge: React.FC<{
	fit: ModelMemoryEstimate["fit"];
	className?: string;
}> = ({ fit, className = "" }) => {
	if (fit === "comfortable")
		return (
			<Badge
				variant="outline"
				className={`border-green-500/60 text-green-600 font-normal text-[10px] px-1.5 py-0 ${className}`}
			>
				Fits
			</Badge>
		);
	if (fit === "tight")
		return (
			<Badge
				variant="outline"
				className={`border-yellow-500/60 text-yellow-600 font-normal text-[10px] px-1.5 py-0 ${className}`}
			>
				Tight
			</Badge>
		);
	return (
		<Badge
			variant="outline"
			className={`border-red-500/60 text-red-500 font-normal text-[10px] px-1.5 py-0 ${className}`}
		>
			Low RAM
		</Badge>
	);
};

/**
 * Abilities the user can act on, shown as badges so the trade-off is visible
 * before the download rather than after it. Tool support is listed first —
 * it is the one that decides whether the default agent works at all.
 */
const AbilityBadges: React.FC<{
	abilities: ModelAbilities;
	className?: string;
}> = ({ abilities, className = "" }) => {
	const { t } = useTranslation("llm");
	const badges: Array<{ key: string; label: string; className: string }> = [];

	if (abilities.tools === "native") {
		badges.push({
			key: "tools",
			label: t("magicSetup.abilities.toolsNative"),
			className: "border-emerald-500/60 text-emerald-600 dark:text-emerald-500",
		});
	} else if (abilities.tools === "none") {
		badges.push({
			key: "tools",
			label: t("magicSetup.abilities.toolsNone"),
			className: "border-red-500/60 text-red-500",
		});
	}

	if (abilities.reasoning) {
		badges.push({
			key: "reasoning",
			label: t("magicSetup.abilities.reasoning"),
			className: "border-purple-500/60 text-purple-600 dark:text-purple-500",
		});
	}

	if (abilities.vision) {
		badges.push({
			key: "vision",
			label: t("magicSetup.abilities.vision"),
			className: "border-blue-500/60 text-blue-600 dark:text-blue-500",
		});
	}

	if (badges.length === 0) {
		return null;
	}

	return (
		<div className={`flex flex-wrap gap-1 ${className}`}>
			{badges.map((badge) => (
				<Badge
					key={badge.key}
					variant="outline"
					className={`font-normal text-[10px] px-1.5 py-0 ${badge.className}`}
				>
					{badge.label}
				</Badge>
			))}
		</div>
	);
};

/** Icon + accent per preference, so the four cards stay one loop. */
const PREFERENCE_CARDS: Array<{
	preference: ModelPreference;
	Icon: LucideIcon;
	tint: string;
	text: string;
}> = [
	{
		preference: "performance",
		Icon: Zap,
		tint: "bg-green-500/10",
		text: "text-green-600 dark:text-green-500",
	},
	{
		preference: "balance",
		Icon: Scale,
		tint: "bg-amber-500/10",
		text: "text-amber-600 dark:text-amber-500",
	},
	{
		preference: "quality",
		Icon: Sparkles,
		tint: "bg-purple-500/10",
		text: "text-purple-600 dark:text-purple-500",
	},
	{
		preference: "context",
		Icon: FileText,
		tint: "bg-blue-500/10",
		text: "text-blue-600 dark:text-blue-500",
	},
];

// ─── Component ───────────────────────────────────────────────────────────────

interface MagicSetupProps {
	onModelSelected: (
		recommendation: ModelRecommendation,
		preference: ModelPreference,
	) => Promise<void>;
	onCancel: () => void;
}

type SetupStep = "detecting" | "specs" | "preference" | "recommendation";
type SortBy = "speed" | "size" | "fit";

export const MagicSetup: React.FC<MagicSetupProps> = ({
	onModelSelected,
	onCancel,
}) => {
	const { t } = useTranslation("llm");

	const [step, setStep] = useState<SetupStep>("detecting");
	const [specs, setSpecs] = useState<SystemSpecs | null>(null);
	const [recommendations, setRecommendations] =
		useState<RecommendationSet | null>(null);
	const [selectedPreference, setSelectedPreference] =
		useState<ModelPreference | null>(null);
	const [selectedModel, setSelectedModel] =
		useState<ModelRecommendation | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filterText, setFilterText] = useState("");
	const [sortBy, setSortBy] = useState<SortBy>("speed");

	// ── Derived memory data ──────────────────────────────────────────────────

	/** Memory estimates for the primary model of each preference. */
	const prefMemory = useMemo(() => {
		if (!recommendations || !specs) return null;
		// Driven off the shared list so a new preference cannot silently produce
		// an `undefined` entry here — the `as Record<...>` cast below would not
		// catch it, and the card would throw on destructure.
		return Object.fromEntries(
			MODEL_PREFERENCES.map((pref) => {
				const m = recommendations[pref].primary;
				const avail = getAvailableModelMemoryGB(specs, m.usesWebGPU);
				const est = estimateModelMemoryAtUsableContext(
					m.sizeGB,
					m.kvBytesPerToken,
					m.contextLength,
					avail,
				);
				return [pref, { est, avail }];
			}),
		) as Record<ModelPreference, { est: ModelMemoryEstimate; avail: number }>;
	}, [recommendations, specs]);

	/** Memory estimate for the currently selected model. */
	const selectedMemory = useMemo(() => {
		if (!selectedModel || !specs) return null;
		const avail = getAvailableModelMemoryGB(specs, selectedModel.usesWebGPU);
		const est = estimateModelMemoryAtUsableContext(
			selectedModel.sizeGB,
			selectedModel.kvBytesPerToken,
			selectedModel.contextLength,
			avail,
		);
		return { est, avail };
	}, [selectedModel, specs]);

	/** Filtered + sorted alternatives. */
	const filteredAlternatives = useMemo(() => {
		if (!recommendations || !selectedPreference || !specs) return [];

		const alts = recommendations[selectedPreference].alternatives;
		const filtered = alts.filter((m) =>
			m.displayName.toLowerCase().includes(filterText.toLowerCase()),
		);

		return [...filtered].sort((a, b) => {
			if (sortBy === "speed")
				return b.estimatedTokensPerSecond - a.estimatedTokensPerSecond;
			if (sortBy === "size") return a.sizeGB - b.sizeGB;
			// "fit" sort: comfortable → tight → overflow, then by total GB
			const fitOrder = { comfortable: 0, tight: 1, overflow: 2 } as const;
			const aAvail = getAvailableModelMemoryGB(specs, a.usesWebGPU);
			const bAvail = getAvailableModelMemoryGB(specs, b.usesWebGPU);
			const aEst = estimateModelMemoryAtUsableContext(
				a.sizeGB,
				a.kvBytesPerToken,
				a.contextLength,
				aAvail,
			);
			const bEst = estimateModelMemoryAtUsableContext(
				b.sizeGB,
				b.kvBytesPerToken,
				b.contextLength,
				bAvail,
			);
			return (
				fitOrder[aEst.fit] - fitOrder[bEst.fit] || aEst.totalGB - bEst.totalGB
			);
		});
	}, [recommendations, selectedPreference, filterText, sortBy, specs]);

	// ── Lifecycle ────────────────────────────────────────────────────────────

	useEffect(() => {
		detectSystem();
	}, []);

	const detectSystem = async () => {
		try {
			setStep("detecting");
			setError(null);

			const { promise } = await backgroundJob.execute(
				"detect-system-specs",
				{},
				{ stream: false },
			);

			const result = await promise;

			if (result.status === "completed" && result.result) {
				const detectedSpecs = result.result.specs as SystemSpecs;
				setSpecs(detectedSpecs);

				const recs = generateAllRecommendations(detectedSpecs);
				if (!recs) {
					setError(
						"Unable to find compatible models for your device. Please try advanced setup.",
					);
					return;
				}

				setRecommendations(recs);
				setStep("specs");
			} else {
				throw new Error(
					result.error || "Failed to detect system specifications",
				);
			}
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Failed to detect system specifications",
			);
		}
	};

	const handlePreferenceSelect = (preference: ModelPreference) => {
		setSelectedPreference(preference);
		if (recommendations) {
			setSelectedModel(recommendations[preference].primary);
		}
		setStep("recommendation");
	};

	const handleDownload = async () => {
		if (!selectedModel || !selectedPreference) return;
		setLoading(true);
		try {
			await onModelSelected(selectedModel, selectedPreference);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to download model");
		} finally {
			setLoading(false);
		}
	};

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div className="space-y-6">
			{/* ── Step 1: Detecting ──────────────────────────────────────────── */}
			{step === "detecting" && (
				<Card>
					<CardContent className="pt-6">
						<div className="flex flex-col items-center justify-center py-8 space-y-4">
							<Loader2 className="w-12 h-12 animate-spin text-primary" />
							<div className="text-center space-y-2">
								<h3 className="text-lg font-semibold">
									{t("magicSetup.detecting.title")}
								</h3>
								<p className="text-sm text-muted-foreground">
									{t("magicSetup.detecting.description")}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* ── Step 2: System Specs ───────────────────────────────────────── */}
			{step === "specs" && specs && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<CheckCircle2 className="w-5 h-5 text-green-600" />
							{t("magicSetup.systemDetected.title")}
						</CardTitle>
						<CardDescription>
							{t("magicSetup.systemDetected.description")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Hardware grid */}
						<div className="grid grid-cols-2 gap-3">
							<div className="flex items-center gap-3 p-3 border rounded-lg">
								<Cpu className="w-5 h-5 text-primary shrink-0" />
								<div>
									<div className="text-sm font-medium">
										{t("magicSetup.systemDetected.cpu")}
									</div>
									<div className="text-xs text-muted-foreground">
										{specs.cpuCores} {t("magicSetup.systemDetected.cores")}
									</div>
								</div>
							</div>

							<div className="flex items-center gap-3 p-3 border rounded-lg">
								<MemoryStick className="w-5 h-5 text-primary shrink-0" />
								<div>
									<div className="text-sm font-medium">
										{t("magicSetup.systemDetected.memory")}
									</div>
									<div className="text-xs text-muted-foreground">
										~{specs.memoryGB} {t("magicSetup.systemDetected.ramGB")}
									</div>
								</div>
							</div>

							<div className="flex items-center gap-3 p-3 border rounded-lg">
								<Zap className="w-5 h-5 text-primary shrink-0" />
								<div>
									<div className="text-sm font-medium">
										{t("magicSetup.systemDetected.webgpu")}
									</div>
									<div className="text-xs text-muted-foreground">
										{specs.hasWebGPU
											? t("magicSetup.systemDetected.available")
											: t("magicSetup.systemDetected.notAvailable")}
									</div>
								</div>
							</div>

							<div className="flex items-center gap-3 p-3 border rounded-lg">
								<Sparkles className="w-5 h-5 text-primary shrink-0" />
								<div>
									<div className="text-sm font-medium">
										{t("magicSetup.systemDetected.deviceClass")}
									</div>
									<div className="text-xs text-muted-foreground capitalize">
										{specs.deviceCategory}
									</div>
								</div>
							</div>
						</div>

						{/* GPU row */}
						{specs.gpu && (
							<div className="p-3 border rounded-lg bg-muted/30">
								<div className="text-sm font-medium mb-1">
									{t("magicSetup.systemDetected.gpuDetected")}
								</div>
								<div className="text-xs text-muted-foreground">
									{specs.gpu.renderer}
								</div>
								{specs.gpu.estimatedVRAM && (
									<div className="text-xs text-muted-foreground">
										~{specs.gpu.estimatedVRAM}{" "}
										{t("magicSetup.systemDetected.vramGB")}
									</div>
								)}
							</div>
						)}

						{/* Memory budget panel */}
						<div className="p-3 border rounded-lg space-y-3">
							<div className="flex items-center gap-2 text-sm font-medium">
								<HardDrive className="w-4 h-4 text-primary" />
								Memory Budget for AI Models
							</div>

							{specs.hasWebGPU &&
								(() => {
									const vramGB = getAvailableModelMemoryGB(specs, true);
									return (
										<div className="space-y-1.5">
											<div className="flex justify-between text-xs">
												<span className="text-muted-foreground">
													GPU (VRAM) — WebGPU models
												</span>
												<span className="font-medium text-foreground">
													{specs.gpu?.estimatedVRAM
														? `~${specs.gpu.estimatedVRAM} GB detected`
														: `~${vramGB} GB estimated`}
												</span>
											</div>
											<MemoryBar usedGB={0} availableGB={vramGB} />
											<div className="text-[11px] text-muted-foreground flex items-center gap-1">
												<Info className="w-3 h-3" />
												Supports WebGPU models up to ~
												{(vramGB / 1.2).toFixed(1)} GB weights
											</div>
										</div>
									);
								})()}

							{(() => {
								const cpuGB = specs.memoryGB * 0.4;
								return (
									<div className="space-y-1.5">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">
												System RAM — CPU (GGUF) models
											</span>
											<span className="font-medium text-foreground">
												~{cpuGB.toFixed(1)} GB available
											</span>
										</div>
										<MemoryBar usedGB={0} availableGB={cpuGB} />
										<div className="text-[11px] text-muted-foreground">
											40% of {specs.memoryGB} GB RAM reserved for AI (rest for
											OS + browser)
										</div>
									</div>
								);
							})()}
						</div>

						<Button onClick={() => setStep("preference")} className="w-full">
							{t("magicSetup.systemDetected.continue")}
						</Button>
					</CardContent>
				</Card>
			)}

			{/* ── Step 3: Choose Preference ──────────────────────────────────── */}
			{step === "preference" && recommendations && specs && prefMemory && (
				<div className="space-y-4">
					<div className="text-center space-y-2">
						<h3 className="text-lg font-semibold">
							{t("magicSetup.choosePriority.title")}
						</h3>
						<p className="text-sm text-muted-foreground">
							{t("magicSetup.choosePriority.description")}
						</p>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
						{PREFERENCE_CARDS.map(({ preference, Icon, tint, text }) => {
							const { est, avail } = prefMemory[preference];
							const m = recommendations[preference].primary;
							const contextLimited = est.feasibleContext < m.contextLength;
							// Context is the one axis where the headline number is the
							// context itself; every other axis leads with speed.
							const headline =
								preference === "context"
									? contextLimited
										? fmtCtx(est.feasibleContext)
										: fmtCtx(m.contextLength)
									: `~${m.estimatedTokensPerSecond} tok/s`;

							return (
								<Card
									key={preference}
									role="button"
									tabIndex={0}
									data-preference={preference}
									className="cursor-pointer transition-all hover:shadow-lg hover:border-primary border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() => handlePreferenceSelect(preference)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											handlePreferenceSelect(preference);
										}
									}}
								>
									<CardHeader className="text-center pb-3">
										<div
											className={`mx-auto mb-3 p-3 rounded-full ${tint} w-fit`}
										>
											<Icon className={`w-6 h-6 ${text}`} />
										</div>
										<CardTitle className="text-lg">
											{t(`magicSetup.choosePriority.${preference}.title`)}
										</CardTitle>
										<CardDescription className="text-xs">
											{t(`magicSetup.choosePriority.${preference}.description`)}
										</CardDescription>
									</CardHeader>
									<CardContent className="space-y-2 text-center">
										<div className={`text-2xl font-bold ${text}`}>
											{headline}
										</div>
										<div className="text-sm font-medium">{m.displayName}</div>
										<div className="text-xs text-primary font-medium">
											{m.providerName}
										</div>
										<div className="text-xs text-muted-foreground">
											{m.size} • {m.usesWebGPU ? "WebGPU" : "CPU"}
										</div>

										<AbilityBadges
											abilities={m.abilities}
											className="justify-center"
										/>

										{/* Memory bar */}
										<div className="pt-2 border-t space-y-1.5 text-left">
											<MemoryBar usedGB={est.totalGB} availableGB={avail} />
											<div className="flex justify-between items-center">
												<span className="text-[11px] text-muted-foreground">
													{fmtGB(est.totalGB)} of {fmtGB(avail)}
												</span>
												<FitBadge fit={est.fit} />
											</div>
											{contextLimited ? (
												<div className="text-[11px] text-yellow-600 dark:text-yellow-500">
													{t("magicSetup.choosePriority.contextLimited", {
														value: fmtCtx(est.feasibleContext),
													})}
												</div>
											) : (
												<div className="text-[11px] text-muted-foreground">
													{t("magicSetup.choosePriority.contextUpTo", {
														value: fmtCtx(m.contextLength),
													})}
												</div>
											)}
										</div>
									</CardContent>
								</Card>
							);
						})}
					</div>

					<Button
						variant="outline"
						onClick={() => setStep("specs")}
						className="w-full"
					>
						{t("magicSetup.choosePriority.backToSpecs")}
					</Button>
				</div>
			)}

			{/* ── Step 4: Recommendation ─────────────────────────────────────── */}
			{step === "recommendation" &&
				selectedPreference &&
				selectedModel &&
				recommendations &&
				specs &&
				selectedMemory && (
					<div className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>{t("magicSetup.recommendation.title")}</CardTitle>
								<CardDescription>
									{t("magicSetup.recommendation.description")}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{/* Model summary */}
								<div className="p-4 border rounded-lg bg-muted/30 space-y-3">
									<div className="flex items-center justify-between">
										<div>
											<div className="font-semibold text-lg">
												{selectedModel.displayName}
											</div>
											<div className="text-sm text-primary font-medium">
												{selectedModel.providerName}
											</div>
											<div className="text-xs text-muted-foreground capitalize">
												{selectedPreference}{" "}
												{t("magicSetup.recommendation.optimized")} •{" "}
												{t("magicSetup.recommendation.released")}{" "}
												{selectedModel.releaseDate}
											</div>
										</div>
										<div className="text-right">
											<div className="text-sm font-medium">
												{selectedModel.size}
											</div>
											<div className="text-xs text-muted-foreground">
												{selectedModel.usesWebGPU ? "WebGPU" : "CPU"}
											</div>
										</div>
									</div>

									<div className="grid grid-cols-2 gap-3 text-sm">
										<div>
											<div className="text-muted-foreground">
												{t("magicSetup.recommendation.speed")}
											</div>
											<div className="font-medium">
												~{selectedModel.estimatedTokensPerSecond}{" "}
												{t("magicSetup.recommendation.tokensPerSec")}
											</div>
										</div>
										<div>
											<div className="text-muted-foreground">
												{t("magicSetup.recommendation.context")}
											</div>
											<div className="font-medium">
												{selectedMemory.est.feasibleContext <
												selectedModel.contextLength ? (
													<>
														<span>
															{fmtCtx(selectedMemory.est.feasibleContext)}
														</span>
														<span className="text-muted-foreground ml-1 font-normal text-xs">
															/ {fmtCtx(selectedModel.contextLength)} max
														</span>
													</>
												) : (
													`${selectedModel.contextLength.toLocaleString()} tokens`
												)}
											</div>
										</div>
									</div>

									{/* Memory breakdown */}
									<div className="border-t pt-3 space-y-2">
										<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
											Memory Breakdown
										</div>
										<div className="grid grid-cols-4 gap-1 text-xs text-center">
											<div className="p-1.5 bg-muted/50 rounded">
												<div className="font-medium">
													{fmtGB(selectedMemory.est.weightsGB)}
												</div>
												<div className="text-muted-foreground">Weights</div>
											</div>
											<div className="p-1.5 bg-muted/50 rounded">
												<div className="font-medium">
													{fmtGB(selectedMemory.est.kvCacheGB)}
												</div>
												<div className="text-muted-foreground">KV Cache</div>
											</div>
											<div className="p-1.5 bg-muted/50 rounded">
												<div className="font-medium">
													{fmtGB(selectedMemory.est.bufferGB)}
												</div>
												<div className="text-muted-foreground">Buffer</div>
											</div>
											<div className="p-1.5 bg-primary/10 border border-primary/20 rounded">
												<div className="font-semibold">
													{fmtGB(selectedMemory.est.totalGB)}
												</div>
												<div className="text-muted-foreground">Total</div>
											</div>
										</div>
										<MemoryBar
											usedGB={selectedMemory.est.totalGB}
											availableGB={selectedMemory.avail}
										/>
										<div className="flex justify-between items-center text-xs">
											<span className="text-muted-foreground">
												{fmtGB(selectedMemory.est.totalGB)} of{" "}
												{fmtGB(selectedMemory.avail)} available
											</span>
											<FitBadge fit={selectedMemory.est.fit} />
										</div>
										{selectedMemory.est.feasibleContext <
											selectedModel.contextLength && (
											<div className="flex items-start gap-1.5 text-xs text-yellow-600 dark:text-yellow-500 bg-yellow-500/10 rounded p-2">
												<AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
												<span>
													KV cache for full{" "}
													{fmtCtx(selectedModel.contextLength)} context needs{" "}
													{fmtGB(
														estimateModelMemory(
															selectedModel.sizeGB,
															selectedModel.kvBytesPerToken,
															selectedModel.contextLength,
															selectedMemory.avail,
														).totalGB,
													)}
													. Your hardware is limited to ~
													{fmtCtx(selectedMemory.est.feasibleContext)} tokens.
												</span>
											</div>
										)}
									</div>

									<div className="pt-2 border-t">
										<div className="text-sm text-muted-foreground">
											{selectedModel.reason}
										</div>
									</div>
								</div>

								<div className="flex gap-2">
									<Button
										onClick={handleDownload}
										disabled={loading}
										className="flex-1"
									>
										{loading ? (
											<>
												<Loader2 className="w-4 h-4 mr-2 animate-spin" />
												{t("magicSetup.recommendation.settingUp")}
											</>
										) : (
											t("magicSetup.recommendation.download")
										)}
									</Button>
									<Button
										variant="outline"
										onClick={() => setStep("preference")}
										disabled={loading}
									>
										{t("magicSetup.recommendation.change")}
									</Button>
								</div>
							</CardContent>
						</Card>

						{/* Alternatives */}
						{recommendations[selectedPreference].alternatives.length > 0 && (
							<Card>
								<CardHeader>
									<CardTitle className="text-base">
										{t("magicSetup.recommendation.alternatives.title", {
											preference: selectedPreference,
										})}
									</CardTitle>
									<CardDescription>
										{t("magicSetup.recommendation.alternatives.description")}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-4">
									{/* Filter + sort */}
									<div className="flex flex-col sm:flex-row gap-2">
										<div className="relative flex-1">
											<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
											<Input
												type="text"
												placeholder="Filter by name..."
												value={filterText}
												onChange={(e) => setFilterText(e.target.value)}
												className="pl-9"
											/>
										</div>
										<div className="flex gap-2">
											<Button
												variant={sortBy === "speed" ? "default" : "outline"}
												size="sm"
												onClick={() => setSortBy("speed")}
												className="flex-1 sm:flex-none"
											>
												<Zap className="w-4 h-4 mr-1" />
												Speed
											</Button>
											<Button
												variant={sortBy === "size" ? "default" : "outline"}
												size="sm"
												onClick={() => setSortBy("size")}
												className="flex-1 sm:flex-none"
											>
												<MemoryStick className="w-4 h-4 mr-1" />
												Size
											</Button>
											<Button
												variant={sortBy === "fit" ? "default" : "outline"}
												size="sm"
												onClick={() => setSortBy("fit")}
												className="flex-1 sm:flex-none"
											>
												<HardDrive className="w-4 h-4 mr-1" />
												Fit
											</Button>
										</div>
									</div>

									<div className="text-xs text-muted-foreground">
										Showing {filteredAlternatives.length} of{" "}
										{recommendations[selectedPreference].alternatives.length}{" "}
										models
									</div>

									<div className="space-y-2">
										{filteredAlternatives.length === 0 ? (
											<div className="text-center py-8 text-muted-foreground text-sm">
												No models found matching "{filterText}"
											</div>
										) : (
											filteredAlternatives.map((altModel) => {
												const altAvail = getAvailableModelMemoryGB(
													specs,
													altModel.usesWebGPU,
												);
												const altEst = estimateModelMemoryAtUsableContext(
													altModel.sizeGB,
													altModel.kvBytesPerToken,
													altModel.contextLength,
													altAvail,
												);
												const isSelected =
													selectedModel.modelId === altModel.modelId;
												return (
													<div
														key={altModel.modelId}
														onClick={() => setSelectedModel(altModel)}
														className={`p-3 border rounded-lg cursor-pointer transition-all hover:border-primary space-y-2 ${
															isSelected ? "border-primary bg-primary/5" : ""
														}`}
													>
														<div className="flex items-start justify-between gap-2">
															<div className="flex-1 min-w-0">
																<div className="flex items-center gap-1.5 flex-wrap">
																	<span className="font-medium text-sm">
																		{altModel.displayName}
																	</span>
																	<span className="text-xs text-primary">
																		{altModel.providerName}
																	</span>
																</div>
																<div className="text-xs text-muted-foreground mt-0.5">
																	{altModel.size} •{" "}
																	{altModel.usesWebGPU ? "WebGPU" : "CPU"} •{" "}
																	{t("magicSetup.recommendation.released")}{" "}
																	{altModel.releaseDate}
																</div>
															</div>
															<div className="text-right text-xs shrink-0">
																<div className="font-medium">
																	~{altModel.estimatedTokensPerSecond} tok/s
																</div>
																<div className="text-muted-foreground">
																	{fmtCtx(altEst.feasibleContext)} ctx
																</div>
																<div className="mt-0.5">
																	<FitBadge fit={altEst.fit} />
																</div>
															</div>
														</div>
														<div className="space-y-1">
															<MemoryBar
																usedGB={altEst.totalGB}
																availableGB={altAvail}
																className="h-1"
															/>
															<div className="text-[10px] text-muted-foreground">
																{fmtGB(altEst.totalGB)} of {fmtGB(altAvail)}
															</div>
														</div>
													</div>
												);
											})
										)}
									</div>
								</CardContent>
							</Card>
						)}
					</div>
				)}

			{/* ── Error ──────────────────────────────────────────────────────── */}
			{error && (
				<Card className="border-destructive">
					<CardContent className="pt-6">
						<div className="flex items-start gap-3">
							<AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
							<div className="space-y-2 flex-1">
								<div className="font-medium text-destructive">
									{t("magicSetup.error.title")}
								</div>
								<div className="text-sm text-muted-foreground">{error}</div>
								<div className="flex gap-2">
									<Button size="sm" variant="outline" onClick={detectSystem}>
										{t("magicSetup.error.tryAgain")}
									</Button>
									<Button size="sm" variant="outline" onClick={onCancel}>
										{t("magicSetup.error.advancedSetup")}
									</Button>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>
			)}

			{/* ── Cancel ─────────────────────────────────────────────────────── */}
			{step !== "detecting" && !error && (
				<Button
					variant="ghost"
					onClick={onCancel}
					className="w-full"
					disabled={loading}
				>
					{t("magicSetup.useAdvancedSetup")}
				</Button>
			)}
		</div>
	);
};
