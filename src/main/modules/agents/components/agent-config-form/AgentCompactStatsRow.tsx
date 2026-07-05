import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, CalendarClock, Network, Sparkles, Wrench } from "lucide-react";
import { CursorPoint } from "@/components/AgentCursor";
import { AGENT_WIZARD_CURSOR_KEYS } from "@/main/modules/agent-wizard";
import { HoverBadgeList } from "../AgentHoverInfo";
import type { AgentConfigSummary } from "../../types";
import type { Topic } from "@/services/database/types";

const StatItem: React.FC<{
	icon: React.ReactNode;
	label: string;
	hoverItems?: string[];
	hoverEmptyLabel?: string;
	hoverBadgeClassName?: string;
	hoverBadgeVariant?: "outline" | "secondary";
}> = ({
	icon,
	label,
	hoverItems,
	hoverEmptyLabel,
	hoverBadgeClassName,
	hoverBadgeVariant,
}) => {
	const inner = (
		<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
			{icon}
			{label}
		</span>
	);

	if (!hoverItems || !hoverEmptyLabel) return inner;

	return (
		<HoverBadgeList
			title={label}
			items={hoverItems}
			emptyLabel={hoverEmptyLabel}
			badgeClassName={hoverBadgeClassName}
			badgeVariant={hoverBadgeVariant}
		>
			<span className="cursor-help transition-colors hover:text-foreground">
				{inner}
			</span>
		</HoverBadgeList>
	);
};

export const AgentCompactStatsRow: React.FC<{
	configSummary?: AgentConfigSummary | null;
	memoryTopic?: Topic | null;
}> = ({ configSummary, memoryTopic }) => {
	const { t } = useTranslation("agents");

	return (
		<CursorPoint
			cursorKey={[
				AGENT_WIZARD_CURSOR_KEYS.status,
				AGENT_WIZARD_CURSOR_KEYS.graphType,
				AGENT_WIZARD_CURSOR_KEYS.growType,
				AGENT_WIZARD_CURSOR_KEYS.recallType,
			]}
			className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
		>
			<StatItem
				icon={<Bot size={12} />}
				label={configSummary?.graphLabel ?? t("state.loading")}
			/>
			<span className="text-border select-none">·</span>
			<StatItem
				icon={<Sparkles size={12} />}
				label={t("summary.featuresValue", {
					count: configSummary?.enabledFeatureCount ?? 0,
				})}
				hoverItems={configSummary?.enabledFeatureLabels}
				hoverEmptyLabel={t("summary.noFeaturesEnabled")}
			/>
			<span className="text-border select-none">·</span>
			<StatItem
				icon={<Wrench size={12} />}
				label={t("summary.toolsValue", {
					count: configSummary?.enabledToolCount ?? 0,
				})}
				hoverItems={configSummary?.enabledToolNames}
				hoverEmptyLabel={t("summary.noToolsEnabled")}
				hoverBadgeClassName="font-mono"
				hoverBadgeVariant="outline"
			/>
			<span className="text-border select-none">·</span>
			<StatItem
				icon={<CalendarClock size={12} />}
				label={
					configSummary?.lastUpdatedAt
						? configSummary.lastUpdatedAt.toLocaleDateString()
						: t("summary.lastUpdatedUnknown")
				}
			/>
			{memoryTopic ? (
				<>
					<span className="text-border select-none">·</span>
					<Link
						to={`/memory?topicId=${encodeURIComponent(memoryTopic.id)}`}
						className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						<Network size={12} />
						{t("summary.openMemoryGraph")}
					</Link>
				</>
			) : null}
		</CursorPoint>
	);
};
