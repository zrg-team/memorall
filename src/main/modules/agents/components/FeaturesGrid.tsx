import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	useAgentConfigStore,
	type AgentFeatureDefinition,
} from "@/main/stores/agent-config";
import type { FeatureIcon } from "@/services/flows/flow-builder-catalog";
import { HoverBadgeList } from "./AgentHoverInfo";
import { FeatureCard, FeatureIconDisplay } from "./FeatureCard";
import {
	getAgentFeatureDescription,
	getAgentFeatureDisplayName,
} from "../utils/feature-display";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import type { AgentConfigSummary } from "../types";

const FEATURES_DEFAULT_VISIBLE = 4;

const hasToolPickerSlot = (feature: AgentFeatureDefinition): boolean =>
	feature.detailView?.some((s) => s.component === "ToolPicker") ?? false;

const hasDetailContent = (feature: AgentFeatureDefinition): boolean =>
	!!(feature.detailView?.length || feature.tools.length || feature.systemPrompt.trim());

interface FeaturesGridProps {
	summary?: AgentConfigSummary | null;
}

export const FeaturesGrid: React.FC<FeaturesGridProps> = ({ summary }) => {
	const { t } = useTranslation(["chat", "agents"]);
	const ta = (key: string, opts?: Record<string, unknown>) =>
		t(key, { ns: "agents", ...opts });

	const {
		draftConfig,
		draftFeatures,
		draftMultiAgentAccessibleAgentIds,
		featureDefinitions,
		availableTools,
		toggleFeature,
	} = useAgentConfigStore();

	const [showAll, setShowAll] = React.useState(false);
	const [collapsed, setCollapsed] = React.useState(false);

	const claimedToolSet = React.useMemo(() => {
		const set = new Set<string>();
		for (const feature of featureDefinitions) {
			for (const tool of feature.tools) set.add(tool);
		}
		return set;
	}, [featureDefinitions]);

	const fallbackEnabledToolNames = React.useMemo(() => {
		const enabledToolSet = new Set(draftConfig.tools);
		for (const feature of featureDefinitions) {
			if (hasToolPickerSlot(feature)) continue;
			if (!draftFeatures[feature.name]) continue;
			if (feature.requiresAccessibleAgents && draftMultiAgentAccessibleAgentIds.length === 0)
				continue;
			for (const tool of feature.tools) enabledToolSet.add(tool);
		}
		const availableToolSet = new Set(availableTools);
		return [
			...availableTools.filter((tool) => enabledToolSet.has(tool)),
			...Array.from(enabledToolSet).filter((tool) => !availableToolSet.has(tool)),
		];
	}, [
		availableTools,
		draftConfig.tools,
		draftFeatures,
		draftMultiAgentAccessibleAgentIds,
		featureDefinitions,
	]);

	const enabledToolNames = summary?.enabledToolNames ?? fallbackEnabledToolNames;
	const enabledToolCount = summary?.enabledToolCount ?? enabledToolNames.length;

	const filteredFeatures = React.useMemo(
		() => featureDefinitions.filter((f) => !f.hideInGrid),
		[featureDefinitions],
	);

	const coreFeatures = filteredFeatures
		.filter((f) => f.section === "core")
		.slice()
		.sort(
			(a, b) =>
				(a.sectionOrder ?? Number.MAX_SAFE_INTEGER) -
				(b.sectionOrder ?? Number.MAX_SAFE_INTEGER),
		);

	const otherFeatures = filteredFeatures
		.filter((f) => f.section !== "core")
		.slice()
		.sort((a, b) => {
			const aLegacy = Boolean(a.legacy);
			const bLegacy = Boolean(b.legacy);
			if (aLegacy !== bLegacy) return aLegacy ? 1 : -1;

			const aEnabled = Boolean(draftFeatures[a.name]);
			const bEnabled = Boolean(draftFeatures[b.name]);
			if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;

			return (
				(a.sectionOrder ?? Number.MAX_SAFE_INTEGER) -
				(b.sectionOrder ?? Number.MAX_SAFE_INTEGER)
			);
		});

	const visibleOtherFeatures = showAll
		? otherFeatures
		: otherFeatures.slice(0, FEATURES_DEFAULT_VISIBLE);
	const hiddenCount = otherFeatures.length - FEATURES_DEFAULT_VISIBLE;

	const isFeatureEffectivelyEnabled = (feature: AgentFeatureDefinition): boolean => {
		if (hasToolPickerSlot(feature)) {
			return draftConfig.tools.length > 0 || draftMultiAgentAccessibleAgentIds.length > 0;
		}
		return Boolean(draftFeatures[feature.name]);
	};

	const enabledFeatures = filteredFeatures.filter(isFeatureEffectivelyEnabled);

	const renderFeatureCard = (feature: AgentFeatureDefinition) => {
		const displayName = getAgentFeatureDisplayName(feature, t);
		const displayDesc = getAgentFeatureDescription(feature, t);

		if (hasToolPickerSlot(feature)) {
			const slot = feature.detailView!.find((s) => s.component === "ToolPicker")!;
			const toolsToShow =
				slot.scope === "all"
					? availableTools
					: availableTools.filter((tool) => !claimedToolSet.has(tool));
			const enabledCount = toolsToShow.filter((tool) =>
				draftConfig.tools.includes(tool),
			).length;

			return (
				<CursorPoint
					key={feature.name}
					cursorKey={AGENT_WIZARD_CURSOR_KEYS.feature(feature.name)}
				>
					<FeatureCard
						feature={feature}
						displayName={displayName}
						displayDesc={displayDesc}
						toolCount={enabledCount}
						totalToolCount={toolsToShow.length}
						hasDetail
					/>
				</CursorPoint>
			);
		}

		return (
			<CursorPoint
				key={feature.name}
				cursorKey={AGENT_WIZARD_CURSOR_KEYS.feature(feature.name)}
			>
				<FeatureCard
					feature={feature}
					enabled={Boolean(draftFeatures[feature.name])}
					onToggle={() => toggleFeature(feature.name)}
					displayName={displayName}
					displayDesc={displayDesc}
					hasDetail={hasDetailContent(feature)}
				/>
			</CursorPoint>
		);
	};

	return (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<button
					type="button"
					onClick={() => setCollapsed((v) => !v)}
					className="flex items-center gap-2 rounded-md px-0.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
				>
					<Sparkles size={13} />
					<span className="text-xs font-medium uppercase tracking-[0.18em]">
						{t("summary.features", { ns: "agents" })}
					</span>
					{collapsed ? (
						<ChevronDown size={11} className="opacity-60" />
					) : (
						<ChevronUp size={11} className="opacity-60" />
					)}
				</button>
				<HoverBadgeList
					title={t("summary.tools", { ns: "agents" })}
					items={enabledToolNames}
					emptyLabel={t("summary.noToolsEnabled", { ns: "agents" })}
					badgeClassName="font-mono"
					badgeVariant="outline"
					align="end"
				>
					<Badge
						variant="outline"
						className="cursor-help bg-background/80 text-[10px]"
					>
						{t("summary.toolsValue", {
							ns: "agents",
							count: enabledToolCount,
						})}
					</Badge>
				</HoverBadgeList>
			</div>

			{collapsed ? (
				/* Compact strip — enabled feature icons only */
				<TooltipProvider delayDuration={300}>
					<div className="flex flex-wrap gap-1.5">
						{enabledFeatures.length === 0 ? (
							<p className="text-[11px] text-muted-foreground/60">
								{ta("featuresSection.noneEnabled")}
							</p>
						) : (
							enabledFeatures.map((feature) => {
								const displayName = getAgentFeatureDisplayName(feature, t);
								const accent =
									typeof feature.accentColor === "string"
										? feature.accentColor
										: "#64748b";
								return (
									<Tooltip key={feature.name}>
										<TooltipTrigger asChild>
											<div
												className="flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-lg border transition-colors"
												style={{
													backgroundColor: `${accent}24`,
													borderColor: `${accent}33`,
													color: accent,
												}}
											>
												<FeatureIconDisplay
													icon={feature.icon as FeatureIcon | undefined}
													size={14}
												/>
											</div>
										</TooltipTrigger>
										<TooltipContent side="top" className="text-xs">
											{displayName}
										</TooltipContent>
									</Tooltip>
								);
							})
						)}
					</div>
				</TooltipProvider>
			) : (
				<>
					{coreFeatures.length > 0 && (
						<div className="space-y-2">
							<p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
								{ta("featuresSection.core")}
							</p>
							<div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 auto-rows-[136px]">
								{coreFeatures.map(renderFeatureCard)}
							</div>
						</div>
					)}

					{otherFeatures.length > 0 && (
						<div className="space-y-2">
							<p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
								{ta("featuresSection.other")}
							</p>
							<div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 auto-rows-[136px]">
								{visibleOtherFeatures.map(renderFeatureCard)}
							</div>
						</div>
					)}

					{hiddenCount > 0 && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 w-full rounded-xl text-xs text-muted-foreground hover:text-foreground"
							onClick={() => setShowAll((v) => !v)}
						>
							<ChevronDown
								size={12}
								className={cn(
									"mr-1.5 transition-transform",
									showAll ? "rotate-180" : "",
								)}
							/>
							{showAll
								? ta("featuresSection.showLess")
								: ta("featuresSection.showMore", { count: hiddenCount })}
						</Button>
					)}
				</>
			)}
		</div>
	);
};
