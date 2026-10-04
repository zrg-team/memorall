import { ArrowDown, ArrowUp } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { UsageSlice } from "../types";
import {
	costCoverageBy,
	toolWeights,
	toolSeries,
	toolTotals,
} from "../utils/usage-aggregate";
import {
	CHARS_PER_TOKEN,
	formatCount,
	formatTokens,
	formatUsdPrecise,
} from "../utils/usage-format";
import { ChangeText, Sparkline, UsageCard } from "./chart-primitives";
import { hasMoney, MetricCell } from "./MetricCell";
import { UsageTable } from "./UsageTable";
import type { UsageViewContext } from "./usage-view";

type SortKey = "value" | "calls" | "result" | "perCall";
const TOP = 10;

export const ToolTableCard: React.FC<{
	current: readonly UsageSlice[];
	previous: readonly UsageSlice[];
	view: UsageViewContext;
}> = ({ current, previous, view }) => {
	const { t } = useTranslation("usage");
	const { metric, palette, buckets } = view;
	const [sort, setSort] = React.useState<{ key: SortKey; descending: boolean }>(
		{
			key: "value",
			descending: true,
		},
	);
	const [showAll, setShowAll] = React.useState(false);

	const data = React.useMemo(() => {
		const now = toolTotals(current, metric);
		const before = toolTotals(previous, metric);
		const series = toolSeries(current, metric, buckets);
		const rows = [...now.values()].map((tool) => ({
			...tool,
			previous: before.get(tool.tool)?.value ?? 0,
			result: tool.calls ? tool.resultChars / CHARS_PER_TOKEN / tool.calls : 0,
			perCall: tool.calls ? tool.value / tool.calls : 0,
		}));
		const total = rows.reduce((sum, row) => sum + row.value, 0);
		const coverage = costCoverageBy(current, toolWeights);
		return { rows, series, total, coverage };
	}, [current, previous, metric, buckets]);

	const sorted = [...data.rows].sort(
		(a, b) =>
			(sort.descending ? -1 : 1) * (a[sort.key] - b[sort.key]) ||
			b.value - a.value,
	);
	const shown = showAll ? sorted : sorted.slice(0, TOP);
	const accent = palette.series[0] ?? palette.other;

	const header = (key: SortKey, label: string) => {
		const active = sort.key === key;
		const Arrow = sort.descending ? ArrowDown : ArrowUp;
		return (
			<button
				type="button"
				aria-sort={
					active ? (sort.descending ? "descending" : "ascending") : "none"
				}
				onClick={() =>
					setSort((previousSort) =>
						previousSort.key === key
							? { key, descending: !previousSort.descending }
							: { key, descending: true },
					)
				}
				className={cn(
					"inline-flex items-center gap-0.5 uppercase tracking-wide hover:text-foreground",
					active && "text-foreground",
				)}
			>
				{label}
				{active ? <Arrow size={10} /> : null}
			</button>
		);
	};

	return (
		<UsageCard
			title={t(metric === "cost" ? "tools.titleCost" : "tools.titleTokens")}
			subtitle={t("tools.subtitle")}
		>
			{!data.rows.length ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("tools.empty")}
				</div>
			) : (
				<>
					<UsageTable
						columns={[
							{ label: t("tools.tool") },
							{ label: header("calls", t("tools.calls")), numeric: true },
							{
								label: header("result", t("tools.avgResult")),
								numeric: true,
								optional: true,
							},
							{
								label: header(
									"perCall",
									t(
										metric === "cost" ? "tools.perCall" : "tools.tokensPerCall",
									),
								),
								numeric: true,
							},
							{
								label: header(
									"value",
									t(metric === "cost" ? "measure.cost" : "measure.tokens"),
								),
								numeric: true,
							},
							{ label: "Δ", numeric: true },
							{ label: t("breakdown.trend"), numeric: true, optional: true },
						]}
						rows={shown.map((row) => ({
							key: row.tool,
							selected: view.filters.tool === row.tool,
							onSelect: () => view.toggleFilter("tool", row.tool),
							cells: [
								<span key="name" className="flex min-w-0 flex-col">
									<span className="truncate font-mono text-xs font-medium">
										{row.tool}
									</span>
									<span className="truncate text-[11px] text-muted-foreground">
										{view.featureLabel(row.feature)}
									</span>
								</span>,
								formatCount(row.calls),
								`~${formatTokens(row.result)}`,
								<MetricCell
									key="per-call"
									value={row.perCall}
									coverage={data.coverage.get(row.tool)}
									view={{
										...view,
										format: metric === "cost" ? formatUsdPrecise : formatTokens,
									}}
								/>,
								<span
									key="total"
									className="inline-flex items-center justify-end gap-2"
								>
									<span className="hidden h-1 w-14 overflow-hidden rounded-full bg-muted-foreground/15 @xl:block">
										<span
											className="block h-full rounded-full"
											style={{
												width: `${data.total > 0 ? (row.value / data.total) * 100 : 0}%`,
												background: accent,
											}}
										/>
									</span>
									<MetricCell
										value={row.value}
										coverage={data.coverage.get(row.tool)}
										view={view}
									/>
								</span>,
								hasMoney(view, data.coverage.get(row.tool)) ? (
									<ChangeText
										key="change"
										current={row.value}
										previous={row.previous}
										polarity={metric === "cost" ? -1 : 0}
										palette={palette}
										newLabel={t("change.new")}
									/>
								) : (
									<span
										key="change"
										className="text-[11px] text-muted-foreground"
									>
										—
									</span>
								),
								<span key="spark" className="flex justify-end">
									<Sparkline
										values={
											data.series.get(row.tool) ??
											new Array(buckets.count).fill(0)
										}
										color={accent}
										palette={palette}
									/>
								</span>,
							],
						}))}
					/>
					{data.rows.length > TOP ? (
						<div className="flex justify-center pt-2">
							<button
								type="button"
								onClick={() => setShowAll((value) => !value)}
								className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
							>
								{showAll
									? t("tools.showTop", { count: TOP })
									: t("tools.showAll", { count: data.rows.length })}
							</button>
						</div>
					) : null}
				</>
			)}
		</UsageCard>
	);
};
