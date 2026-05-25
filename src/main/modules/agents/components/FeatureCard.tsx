import React from "react";
import { useTranslation } from "react-i18next";
import {
	AppWindow,
	Bot,
	Brain,
	Briefcase,
	ChevronRight,
	Database,
	FileOutput,
	FilePlus,
	FileText,
	Film,
	FolderOpen,
	GitFork,
	Globe,
	HardDrive,
	Languages,
	ListChecks,
	Minimize2,
	Newspaper,
	PanelsTopLeft,
	Plug,
	Quote,
	Shapes,
	Terminal,
	TrendingUp,
	Wrench,
} from "lucide-react";
import NiceModal from "@ebay/nice-modal-react";
import { AgentFeatureDetailModal } from "@/main/modules/agents/modals/AgentFeatureDetailModal";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { Switch } from "@/main/components/ui/switch";
import { cn } from "@/lib/utils";
import type { FeatureIcon } from "@/services/flows/flow-builder-catalog";
import type { AgentFeatureDefinition } from "@/main/stores/agent-config";

// ---------------------------------------------------------------------------
// Lucide icon lookup — add names here as new features register them
// ---------------------------------------------------------------------------
export const LUCIDE_MAP: Record<
	string,
	React.ComponentType<{ size?: number; className?: string }>
> = {
	AppWindow,
	Bot,
	Brain,
	Briefcase,
	Database,
	FileOutput,
	FilePlus,
	FileText,
	Film,
	FolderOpen,
	GitFork,
	Globe,
	HardDrive,
	Languages,
	ListChecks,
	Minimize2,
	Newspaper,
	PanelsTopLeft,
	Plug,
	Quote,
	Terminal,
	TrendingUp,
	Wrench,
};

const getFeatureAccent = (feature: AgentFeatureDefinition): string =>
	typeof feature.accentColor === "string" ? feature.accentColor : "#64748b";

// ---------------------------------------------------------------------------
// FeatureIcon renderer
// ---------------------------------------------------------------------------
export const FeatureIconDisplay: React.FC<{
	icon: FeatureIcon | undefined;
	size?: number;
	className?: string;
}> = ({ icon, size = 16, className }) => {
	if (!icon) return <Shapes size={size} className={className} />;
	if (icon.type === "emoji") {
		return (
			<span
				className={cn("leading-none", className)}
				style={{ fontSize: size + 2 }}
				role="img"
			>
				{icon.name}
			</span>
		);
	}
	const LucideIcon = LUCIDE_MAP[icon.name];
	return LucideIcon ? (
		<LucideIcon size={size} className={className} />
	) : (
		<Shapes size={size} className={className} />
	);
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface FeatureCardProps {
	feature: AgentFeatureDefinition;
	enabled?: boolean;
	onToggle?: () => void;
	toolCount?: number;
	totalToolCount?: number;
	hasDetail?: boolean;
	displayName: string;
	displayDesc: string;
}

// ---------------------------------------------------------------------------
// FeatureCard
// ---------------------------------------------------------------------------
export const FeatureCard: React.FC<FeatureCardProps> = ({
	feature,
	enabled = false,
	onToggle,
	toolCount,
	totalToolCount,
	hasDetail = false,
	displayName,
	displayDesc,
}) => {
	const { t } = useTranslation("chat");
	const accent = getFeatureAccent(feature);
	const legacy = Boolean(feature.legacy);
	const showToolsBadge =
		toolCount !== undefined && totalToolCount !== undefined;
	const showDetailBtn = hasDetail;

	return (
		<div
			style={
				{
					"--feature-accent": accent,
					borderColor: enabled && !legacy ? `${accent}55` : undefined,
				} as React.CSSProperties
			}
			className={cn(
				"group relative h-full flex flex-col justify-between gap-3 overflow-hidden rounded-2xl border bg-card p-4 transition-colors hover:border-[color:var(--feature-accent)]/50 pb-3",
				enabled && !legacy
					? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--feature-accent)_10%,transparent),transparent_55%)]"
					: "border-border/30 bg-card/50",
				legacy &&
					"opacity-50 cursor-not-allowed pointer-events-none select-none",
			)}
		>
			{/* Header row: icon + name/desc + toggle */}
			<div className="flex items-start gap-3">
				{/* Icon */}
				<div
					className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors"
					style={{
						backgroundColor: `${accent}24`,
						borderColor: `${accent}33`,
						color: accent,
					}}
				>
					<FeatureIconDisplay
						icon={feature.icon as FeatureIcon | undefined}
						size={16}
						className="text-[color:var(--feature-accent)]"
					/>
				</div>

				{/* Name + description */}
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex items-center gap-1.5">
						<span
							className={cn(
								"h-1.5 w-1.5 rounded-full shrink-0",
								enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
							)}
						/>
						<p className="truncate text-sm font-semibold leading-tight">
							{displayName}
						</p>
					</div>
					<p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
						{displayDesc}
					</p>
				</div>

				{/* Toggle — absent for legacy features and ToolPicker features (no onToggle passed) */}
				{onToggle && !legacy && (
					<Switch
						checked={enabled}
						onCheckedChange={onToggle}
						className="shrink-0"
					/>
				)}
			</div>

			{/* Footer row: badge + detail */}
			<div className="flex items-center justify-between gap-2">
				{legacy ? (
					<Badge
						variant="outline"
						className="text-[10px] text-muted-foreground"
					>
						Deprecated
					</Badge>
				) : showToolsBadge ? (
					<Badge variant="secondary" className="text-[10px]">
						{toolCount}/{totalToolCount}
					</Badge>
				) : (
					<Badge variant="secondary" className="text-[10px]">
						{t("agentSettings.toolCount", { count: feature.tools.length })}
					</Badge>
				)}
				{showDetailBtn && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 rounded-lg px-2 text-[10px]"
						onClick={() =>
							void NiceModal.show(AgentFeatureDetailModal, {
								featureName: feature.name,
							})
						}
					>
						<ChevronRight size={10} className="mr-1" />
						{t("agentSettings.detail")}
					</Button>
				)}
			</div>
		</div>
	);
};
