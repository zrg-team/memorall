import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { UsageSlice } from "../types";
import {
	costCoverageBy,
	featureSeries,
	featureTotals,
	featureWeights,
} from "../utils/usage-aggregate";
import { formatCount } from "../utils/usage-format";
import { ChangeText, Sparkline, UsageCard } from "./chart-primitives";
import { hasMoney, MetricCell } from "./MetricCell";
import type { UsageViewContext } from "./usage-view";

/** Features ranked as horizontal bars, one hue, value at the bar's end. */
export const FeatureCard: React.FC<{
	current: readonly UsageSlice[];
	previous: readonly UsageSlice[];
	view: UsageViewContext;
}> = ({ current, previous, view }) => {
	const { t } = useTranslation("usage");
	const { metric, palette, buckets } = view;

	const data = React.useMemo(() => {
		const now = featureTotals(current, metric);
		const before = featureTotals(previous, metric);
		const series = featureSeries(current, metric, buckets);
		const rows = [...new Set([...now.keys(), ...before.keys()])]
			.map((key) => ({
				key,
				value: now.get(key)?.value ?? 0,
				requests: now.get(key)?.requests ?? 0,
				previous: before.get(key)?.value ?? 0,
			}))
			.sort((a, b) => b.value - a.value || b.previous - a.previous);
		const max = Math.max(0, ...rows.map((row) => row.value));
		const coverage = costCoverageBy(current, featureWeights);
		return { rows, series, max, coverage };
	}, [current, previous, metric, buckets]);

	const accent = palette.series[0] ?? palette.other;

	return (
		<UsageCard
			title={t(
				metric === "cost" ? "features.titleCost" : "features.titleTokens",
			)}
			subtitle={t("features.subtitle")}
		>
			{!data.rows.length ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("empty.filtered")}
				</div>
			) : (
				<div className="flex flex-col">
					{data.rows.map((row) => {
						const selected = view.filters.feature === row.key;
						const ratio = data.max > 0 ? row.value / data.max : 0;
						return (
							<button
								key={row.key}
								type="button"
								aria-pressed={selected}
								onClick={() => view.toggleFilter("feature", row.key)}
								className={cn(
									"grid w-full grid-cols-[minmax(96px,120px)_minmax(0,1fr)_56px] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 @md:grid-cols-[minmax(110px,150px)_minmax(0,1fr)_56px_64px]",
									selected && "bg-blue-500/10 hover:bg-blue-500/10",
								)}
							>
								<span className="flex min-w-0 flex-col">
									<span className="truncate text-[13px] font-medium">
										{view.featureLabel(row.key)}
									</span>
									<span className="truncate text-[11px] text-muted-foreground">
										{t("features.requests", {
											count: row.requests,
											formatted: formatCount(row.requests),
										})}
									</span>
								</span>
								<span className="flex min-w-0 items-center gap-2">
									<span
										className="h-3 min-w-[2px] shrink-0 rounded-r"
										style={{
											width: `calc((100% - 68px) * ${ratio.toFixed(4)})`,
											background: accent,
										}}
									/>
									<span className="whitespace-nowrap text-xs tabular-nums">
										<MetricCell
											value={row.value}
											coverage={data.coverage.get(row.key)}
											align="start"
											view={view}
										/>
									</span>
								</span>
								<span className="text-right">
									{hasMoney(view, data.coverage.get(row.key)) ? (
										<ChangeText
											current={row.value}
											previous={row.previous}
											polarity={metric === "cost" ? -1 : 0}
											palette={palette}
											newLabel={t("change.new")}
										/>
									) : (
										<span className="text-[11px] text-muted-foreground">—</span>
									)}
								</span>
								<span className="hidden justify-end @md:flex">
									<Sparkline
										values={
											data.series.get(row.key) ??
											new Array(buckets.count).fill(0)
										}
										color={accent}
										palette={palette}
									/>
								</span>
							</button>
						);
					})}
				</div>
			)}
		</UsageCard>
	);
};
