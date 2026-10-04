import React from "react";
import { useTranslation } from "react-i18next";
import type { UsageSlice } from "../types";
import { resolveDays, sliceValue, totalSeries } from "../utils/usage-aggregate";
import { formatLongDate, formatShortDate } from "../utils/usage-format";
import {
	ChangeText,
	Legend,
	SegmentedControl,
	UsageCard,
} from "./chart-primitives";
import { TrendChart } from "./TrendChart";
import { UsageTable } from "./UsageTable";
import type { UsageViewContext } from "./usage-view";

const DAY = 86_400_000;

export const TrendCard: React.FC<{
	current: readonly UsageSlice[];
	previous: readonly UsageSlice[];
	view: UsageViewContext;
}> = ({ current, previous, view }) => {
	const { t } = useTranslation("usage");
	const [mode, setMode] = React.useState<"chart" | "table">("chart");
	const { range, metric, palette, locale } = view;

	const data = React.useMemo(() => {
		const days = resolveDays(range);
		const value = (slice: UsageSlice) => sliceValue(slice, metric);
		const now = totalSeries(current, value, days);
		// The previous period, laid over the current days one for one.
		const shift = range.start - range.previousStart;
		const before = totalSeries(
			previous.map((slice) => ({
				...slice,
				request: { ...slice.request, at: slice.request.at + shift },
			})),
			value,
			days,
		);
		return { days, now, before };
	}, [current, previous, range, metric]);

	const total = data.now.reduce((sum, value) => sum + value, 0);
	const previousTotal = data.before.reduce((sum, value) => sum + value, 0);
	const dayStart = (index: number) => data.days.edges[index] ?? range.start;
	const previousDay = (index: number) =>
		range.previousStart + (dayStart(index) - range.start) + DAY / 2;

	return (
		<UsageCard
			title={t(metric === "cost" ? "trend.titleCost" : "trend.titleTokens")}
			subtitle={
				<span className="inline-flex flex-wrap items-center gap-1.5">
					{t("trend.subtitle", { compare: view.compareLabel })}
					<ChangeText
						current={total}
						previous={previousTotal}
						polarity={metric === "cost" ? -1 : 0}
						palette={palette}
						newLabel={t("change.new")}
					/>
				</span>
			}
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
			<Legend
				shape="line"
				items={[
					{
						key: "current",
						name: `${t("trend.current")} · ${view.format(total)}`,
						color: palette.series[0] ?? palette.other,
					},
					{
						key: "previous",
						name: `${t("trend.previous")} · ${view.format(previousTotal)}`,
						color: palette.previous,
					},
				]}
			/>
			{!total && !previousTotal ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("empty.filtered")}
				</div>
			) : mode === "table" ? (
				<UsageTable
					capped
					columns={[
						{ label: t("trend.date") },
						{ label: t("trend.current"), numeric: true },
						{ label: t("trend.previousDate") },
						{ label: t("trend.previous"), numeric: true },
					]}
					rows={data.now
						.map((value, index) => ({
							key: String(index),
							cells: [
								formatLongDate(dayStart(index), locale),
								view.format(value),
								formatShortDate(previousDay(index), locale),
								view.format(data.before[index] ?? 0),
							],
						}))
						.reverse()}
				/>
			) : (
				<TrendChart
					current={data.now}
					previous={data.before}
					dayLabel={(index) => formatShortDate(dayStart(index), locale)}
					dayTitle={(index) => formatLongDate(dayStart(index), locale)}
					previousDayLabel={(index) =>
						formatShortDate(previousDay(index), locale)
					}
					format={view.format}
					formatAxis={view.formatAxis}
					palette={palette}
					labels={{
						current: t("trend.current"),
						peak: t("trend.peak"),
						ariaLabel: t("trend.ariaLabel"),
						keyboard: t("trend.keyboard"),
					}}
				/>
			)}
		</UsageCard>
	);
};
