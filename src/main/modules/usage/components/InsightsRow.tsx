import { Cpu, DatabaseZap, TrendingUp, Wrench, Zap } from "lucide-react";
import type React from "react";
import { Trans, useTranslation } from "react-i18next";
import type { UsageFilterKey, UsageInsight } from "../types";
import {
	formatPercent,
	formatShortDate,
	formatTokens,
} from "../utils/usage-format";
import type { UsageViewContext } from "./usage-view";

const ICONS = {
	agentRise: TrendingUp,
	peakDay: Zap,
	topTool: Wrench,
	cacheHit: DatabaseZap,
	local: Cpu,
} as const;

const strong = { b: <b className="font-semibold text-foreground" /> };

export const InsightsRow: React.FC<{
	insights: readonly UsageInsight[];
	view: UsageViewContext;
}> = ({ insights, view }) => {
	const { t } = useTranslation("usage");
	if (!insights.length) return null;

	const describe = (
		insight: UsageInsight,
	): {
		text: React.ReactNode;
		action?: { label: string; key: UsageFilterKey; value: string };
	} => {
		switch (insight.kind) {
			case "agentRise":
				return {
					text: (
						<Trans
							t={t}
							i18nKey="insights.agentRise"
							values={{
								agent: view.agentLabel(insight.agent),
								change: Math.round(insight.change * 100),
								delta: view.format(insight.delta),
								compare: view.compareLabel,
							}}
							components={strong}
						/>
					),
					action: {
						label: t("insights.focus", {
							name: view.agentLabel(insight.agent),
						}),
						key: "agent",
						value: insight.agent,
					},
				};
			case "peakDay":
				return {
					text: (
						<Trans
							t={t}
							i18nKey="insights.peakDay"
							values={{
								day: formatShortDate(insight.day, view.locale),
								value: view.format(insight.value),
								ratio: insight.ratio.toFixed(1),
								title: insight.conversationTitle || t("conversations.untitled"),
								share: formatPercent(insight.share),
							}}
							components={strong}
						/>
					),
				};
			case "topTool":
				return {
					text: (
						<Trans
							t={t}
							i18nKey="insights.topTool"
							values={{
								tool: insight.tool,
								tokens: formatTokens(insight.avgResultTokens),
								share: formatPercent(insight.share),
							}}
							components={{
								...strong,
								code: <b className="font-mono font-semibold text-foreground" />,
							}}
						/>
					),
					action: {
						label: t("insights.filterTool"),
						key: "tool",
						value: insight.tool,
					},
				};
			case "cacheHit":
				return {
					text: (
						<Trans
							t={t}
							i18nKey="insights.cacheHit"
							values={{ share: formatPercent(insight.ratio) }}
							components={strong}
						/>
					),
				};
			case "local":
				return {
					text: (
						<Trans
							t={t}
							i18nKey="insights.local"
							values={{ share: formatPercent(insight.share) }}
							components={strong}
						/>
					),
				};
		}
	};

	return (
		<section
			aria-label={t("insights.label")}
			className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3"
		>
			{insights.map((insight) => {
				const Icon = ICONS[insight.kind];
				const { text, action } = describe(insight);
				return (
					<div
						key={insight.kind}
						className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-background p-3 text-xs leading-relaxed text-muted-foreground"
					>
						<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
							<Icon size={14} />
						</span>
						<div className="min-w-0">
							<p className="m-0">{text}</p>
							{action ? (
								<button
									type="button"
									onClick={() => view.toggleFilter(action.key, action.value)}
									className="mt-1 font-medium text-blue-500 hover:underline"
								>
									{action.label} →
								</button>
							) : null}
						</div>
					</div>
				);
			})}
		</section>
	);
};
