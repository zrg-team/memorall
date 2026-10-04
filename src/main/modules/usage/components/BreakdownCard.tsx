import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { UsageFilterKey, UsageRequest, UsageSlice } from "../types";
import {
	costCoverageBy,
	requestWeights,
	seriesBy,
	sliceValue,
	totalsBy,
} from "../utils/usage-aggregate";
import { formatPercent } from "../utils/usage-format";
import {
	ChangeText,
	Legend,
	SegmentedControl,
	Sparkline,
	UsageCard,
} from "./chart-primitives";
import { hasMoney, MetricCell } from "./MetricCell";
import { type ColumnSeries, StackedColumnChart } from "./StackedColumnChart";
import { UsageTable } from "./UsageTable";
import type { UsageViewContext } from "./usage-view";

const OTHER_KEY = "\u0000other";

export interface BreakdownDimension {
	filterKey: Extract<UsageFilterKey, "agent" | "model">;
	keyOf: (request: UsageRequest) => string;
	colors: Map<string, string>;
	label: (key: string) => { name: string; sub: string };
	mono?: boolean;
	title: string;
	column: string;
}

/** Stacked columns over time for the top five, then every row ranked. */
export const BreakdownCard: React.FC<{
	current: readonly UsageSlice[];
	previous: readonly UsageSlice[];
	dimension: BreakdownDimension;
	view: UsageViewContext;
}> = ({ current, previous, dimension, view }) => {
	const { t } = useTranslation("usage");
	const [mode, setMode] = React.useState<"chart" | "table">("chart");
	const { metric, palette, buckets } = view;

	const data = React.useMemo(() => {
		const value = (slice: UsageSlice) => sliceValue(slice, metric);
		const perKey = seriesBy(current, dimension.keyOf, value, buckets);
		const now = totalsBy(current, dimension.keyOf, metric);
		const before = totalsBy(previous, dimension.keyOf, metric);
		const other = new Array<number>(buckets.count).fill(0);
		const series: ColumnSeries[] = [];
		const colored = [...perKey.keys()]
			.filter((key) => dimension.colors.get(key) !== palette.other)
			.sort(
				(a, b) =>
					palette.series.indexOf(dimension.colors.get(a) ?? "") -
					palette.series.indexOf(dimension.colors.get(b) ?? ""),
			);
		for (const [key, values] of perKey) {
			if (colored.includes(key)) continue;
			values.forEach((amount, index) => {
				other[index] = (other[index] ?? 0) + amount;
			});
		}
		for (const key of colored) {
			const values = perKey.get(key) ?? [];
			if (values.some((amount) => amount > 0)) {
				series.push({
					key,
					name: dimension.label(key).name,
					color: dimension.colors.get(key) ?? palette.other,
					values,
				});
			}
		}
		if (other.some((amount) => amount > 0)) {
			series.push({
				key: OTHER_KEY,
				name: t("breakdown.other"),
				color: palette.other,
				values: other,
			});
		}
		const rows = [...new Set([...now.keys(), ...before.keys()])]
			.map((key) => ({
				key,
				value: now.get(key) ?? 0,
				previous: before.get(key) ?? 0,
			}))
			.sort((a, b) => b.value - a.value || b.previous - a.previous);
		const total = rows.reduce((sum, row) => sum + row.value, 0);
		const coverage = costCoverageBy(current, requestWeights(dimension.keyOf));
		return { perKey, series, rows, total, coverage };
	}, [current, previous, dimension, metric, buckets, palette, t]);

	const title = t(
		metric === "cost" ? "breakdown.costBy" : "breakdown.tokensBy",
		{
			name: dimension.title,
		},
	);

	return (
		<UsageCard
			title={title}
			subtitle={t(
				buckets.unit === "day"
					? "breakdown.subtitleDaily"
					: "breakdown.subtitleWeekly",
			)}
			actions={
				<SegmentedControl
					size="sm"
					label={t("view.label")}
					value={mode}
					onChange={setMode}
					options={[
						{ value: "chart", label: t("view.chart") },
						{ value: "table", label: t("view.table") },
					]}
				/>
			}
		>
			{!data.rows.length ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("empty.filtered")}
				</div>
			) : (
				<>
					<Legend items={data.series} />
					{mode === "table" ? (
						<UsageTable
							capped
							columns={[
								{
									label: t(
										buckets.unit === "day" ? "trend.date" : "breakdown.week",
									),
								},
								...data.series.map((entry) => ({
									label: entry.name,
									numeric: true,
								})),
								{ label: t("breakdown.total"), numeric: true },
							]}
							rows={Array.from({ length: buckets.count }, (_, index) => ({
								key: String(index),
								cells: [
									view.bucketTitle(index),
									...data.series.map((entry) =>
										view.format(entry.values[index] ?? 0),
									),
									view.format(
										data.series.reduce(
											(sum, entry) => sum + (entry.values[index] ?? 0),
											0,
										),
									),
								],
							})).reverse()}
						/>
					) : (
						<StackedColumnChart
							series={data.series}
							bucketLabel={view.bucketLabel}
							bucketTitle={view.bucketTitle}
							format={view.format}
							formatAxis={view.formatAxis}
							totalLabel={t("breakdown.total")}
							ariaLabel={title}
							palette={palette}
						/>
					)}
					<div className="mt-3 border-t border-border/60 pt-2">
						<div className="grid grid-cols-[minmax(0,1fr)_68px_56px] items-center gap-3 px-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground @md:grid-cols-[minmax(0,1fr)_68px_56px_64px] @lg:grid-cols-[minmax(0,1fr)_96px_68px_56px_64px]">
							<span>{dimension.column}</span>
							<span className="hidden @lg:block">{t("breakdown.share")}</span>
							<span className="text-right">
								{t(metric === "cost" ? "measure.cost" : "measure.tokens")}
							</span>
							<span className="text-right">Δ</span>
							<span className="hidden text-right @md:block">
								{t("breakdown.trend")}
							</span>
						</div>
						{data.rows.map((row) => {
							const color = dimension.colors.get(row.key) ?? palette.other;
							const label = dimension.label(row.key);
							const selected = view.filters[dimension.filterKey] === row.key;
							const coverage = data.coverage.get(row.key);
							const readable = hasMoney(view, coverage);
							const share = data.total > 0 ? row.value / data.total : 0;
							return (
								<button
									key={row.key}
									type="button"
									aria-pressed={selected}
									title={
										selected
											? t("filters.clear")
											: t("filters.focus", { name: label.name })
									}
									onClick={() =>
										view.toggleFilter(dimension.filterKey, row.key)
									}
									className={cn(
										"grid w-full grid-cols-[minmax(0,1fr)_68px_56px] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60 @md:grid-cols-[minmax(0,1fr)_68px_56px_64px] @lg:grid-cols-[minmax(0,1fr)_96px_68px_56px_64px]",
										selected && "bg-blue-500/10 hover:bg-blue-500/10",
									)}
								>
									<span className="flex min-w-0 items-center gap-2">
										<span
											className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
											style={{ background: color }}
										/>
										<span className="flex min-w-0 flex-col">
											<span
												className={cn(
													"truncate text-[13px] font-medium",
													dimension.mono && "font-mono text-xs",
												)}
											>
												{label.name}
											</span>
											<span className="truncate text-[11px] text-muted-foreground">
												{label.sub}
											</span>
										</span>
									</span>
									<span className="hidden items-center gap-1.5 @lg:flex">
										<span className="h-1 flex-1 overflow-hidden rounded-full bg-muted-foreground/15">
											<span
												className="block h-full rounded-full"
												style={{ width: `${share * 100}%`, background: color }}
											/>
										</span>
										<span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
											{readable ? formatPercent(share) : ""}
										</span>
									</span>
									<span className="text-right text-[13px] tabular-nums">
										<MetricCell
											value={row.value}
											coverage={coverage}
											view={view}
										/>
									</span>
									<span className="text-right">
										{!readable ? (
											<span className="text-[11px] text-muted-foreground">
												—
											</span>
										) : (
											<ChangeText
												current={row.value}
												previous={row.previous}
												polarity={metric === "cost" ? -1 : 0}
												palette={palette}
												newLabel={t("change.new")}
											/>
										)}
									</span>
									<span className="hidden justify-end @md:flex">
										<Sparkline
											values={
												data.perKey.get(row.key) ??
												new Array(buckets.count).fill(0)
											}
											color={color}
											palette={palette}
										/>
									</span>
								</button>
							);
						})}
					</div>
				</>
			)}
		</UsageCard>
	);
};
