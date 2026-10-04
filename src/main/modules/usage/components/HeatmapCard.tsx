import React from "react";
import { useTranslation } from "react-i18next";
import type { UsageSlice } from "../types";
import { weekHourGrid } from "../utils/usage-aggregate";
import { formatCount } from "../utils/usage-format";
import { ChartTooltip, UsageCard } from "./chart-primitives";
import type { UsageViewContext } from "./usage-view";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const pad = (hour: number) => String(hour).padStart(2, "0");

/** Weekday × hour, six weight steps of one hue; empty cells stay neutral. */
export const HeatmapCard: React.FC<{
	current: readonly UsageSlice[];
	view: UsageViewContext;
}> = ({ current, view }) => {
	const { t } = useTranslation("usage");
	const { palette, metric, locale } = view;
	const [hover, setHover] = React.useState<{
		day: number;
		hour: number;
		x: number;
		y: number;
	} | null>(null);

	const grid = React.useMemo(() => {
		const { values, requests } = weekHourGrid(current, metric);
		const filled = values
			.flat()
			.filter((value) => value > 0)
			.sort((a, b) => a - b);
		const thresholds = [1, 2, 3, 4, 5].map(
			(step) =>
				filled[Math.floor((filled.length * step) / 6)] ??
				Number.POSITIVE_INFINITY,
		);
		const level = (value: number) =>
			value <= 0 ? 0 : 1 + thresholds.filter((limit) => value >= limit).length;
		return { values, requests, level, empty: filled.length === 0 };
	}, [current, metric]);

	// Monday-first weekday names in the reader's language.
	const days = React.useMemo(
		() =>
			Array.from({ length: 7 }, (_, index) =>
				new Date(2024, 0, 1 + index).toLocaleDateString(locale, {
					weekday: "short",
				}),
			),
		[locale],
	);

	return (
		<UsageCard
			title={t("heatmap.title")}
			subtitle={t(
				metric === "cost" ? "heatmap.subtitleCost" : "heatmap.subtitleTokens",
			)}
		>
			{grid.empty ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("empty.filtered")}
				</div>
			) : (
				<div className="relative" onPointerLeave={() => setHover(null)}>
					<div className="grid grid-cols-[30px_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-muted-foreground">
						<span />
						{HOURS.map((hour) => (
							<span key={hour} className="h-3.5 tabular-nums">
								{hour % 6 === 0 ? pad(hour) : ""}
							</span>
						))}
						{days.map((name, day) => (
							<React.Fragment key={name}>
								<span className="flex h-4 items-center">{name}</span>
								{HOURS.map((hour) => {
									const value = grid.values[day]?.[hour] ?? 0;
									const active = hover?.day === day && hover.hour === hour;
									return (
										<span
											key={hour}
											className="h-4 rounded-[3px]"
											style={{
												background: palette.heat[grid.level(value)],
												boxShadow: active
													? `0 0 0 2px ${palette.surface}, 0 0 0 3px currentColor`
													: undefined,
											}}
											onPointerEnter={(event) => {
												const box =
													event.currentTarget.offsetParent?.getBoundingClientRect();
												const cell =
													event.currentTarget.getBoundingClientRect();
												setHover({
													day,
													hour,
													x: box ? cell.left - box.left + cell.width / 2 : 0,
													y: box ? cell.top - box.top + cell.height : 0,
												});
											}}
										/>
									);
								})}
							</React.Fragment>
						))}
					</div>
					<div className="mt-2.5 flex items-center justify-end gap-[3px] text-[11px] text-muted-foreground">
						<span className="mr-1">{t("heatmap.less")}</span>
						{palette.heat.map((color) => (
							<i
								key={color}
								className="h-2.5 w-3.5 rounded-[2px]"
								style={{ background: color }}
							/>
						))}
						<span className="ml-1">{t("heatmap.more")}</span>
					</div>
					{hover ? (
						<ChartTooltip
							x={hover.x}
							y={hover.y}
							content={{
								title: `${days[hover.day] ?? ""} · ${pad(hover.hour)}:00–${pad(hover.hour + 1)}:00`,
								rows: [
									{
										color: palette.heat[5] ?? palette.other,
										value: view.format(
											grid.values[hover.day]?.[hover.hour] ?? 0,
										),
										label: t("heatmap.requests", {
											count: grid.requests[hover.day]?.[hover.hour] ?? 0,
											formatted: formatCount(
												grid.requests[hover.day]?.[hover.hour] ?? 0,
											),
										}),
									},
								],
							}}
						/>
					) : null}
				</div>
			)}
		</UsageCard>
	);
};
