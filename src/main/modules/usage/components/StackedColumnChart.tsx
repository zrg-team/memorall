import React from "react";
import { niceTicks } from "../utils/usage-format";
import {
	ChartTooltip,
	labelIndexes,
	round2,
	roundedTopPath,
	useElementWidth,
} from "./chart-primitives";
import type { UsagePalette } from "./usage-palette";

const HEIGHT = 200;
const MARGIN = { left: 52, right: 8, top: 10, bottom: 28 };
const GAP = 2;

export interface ColumnSeries {
	key: string;
	name: string;
	color: string;
	values: readonly number[];
}

interface StackedColumnChartProps {
	series: readonly ColumnSeries[];
	bucketLabel: (index: number) => string;
	bucketTitle: (index: number) => string;
	format: (value: number) => string;
	formatAxis: (value: number, step: number) => string;
	totalLabel: string;
	ariaLabel: string;
	palette: UsagePalette;
}

/**
 * Columns stacked bottom-up in series order, separated by a 2px surface gap,
 * with a rounded top on each column. Hovering a column lists every series in it.
 */
export const StackedColumnChart: React.FC<StackedColumnChartProps> = ({
	series,
	bucketLabel,
	bucketTitle,
	format,
	formatAxis,
	totalLabel,
	ariaLabel,
	palette,
}) => {
	const [ref, measured] = useElementWidth<HTMLDivElement>();
	const [hover, setHover] = React.useState<{
		index: number;
		x: number;
		y: number;
	} | null>(null);
	const width = Math.max(240, measured);
	const count = series[0]?.values.length ?? 0;
	const totals = Array.from({ length: count }, (_, index) =>
		series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
	);
	const innerWidth = width - MARGIN.left - MARGIN.right;
	const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
	const { ticks, top, step } = niceTicks(Math.max(0, ...totals));
	const y = (value: number) =>
		MARGIN.top + innerHeight - (value / top) * innerHeight;
	const slot = count ? innerWidth / count : innerWidth;
	const barWidth = Math.max(3, Math.min(24, slot * 0.62));
	const xLabels = labelIndexes(
		count,
		Math.max(2, Math.min(7, Math.floor(innerWidth / 64))),
	);

	const columns = totals.map((_, index) => {
		const x0 = MARGIN.left + slot * index + (slot - barWidth) / 2;
		const active = series
			.map((entry, position) => ({
				entry,
				position,
				value: entry.values[index] ?? 0,
			}))
			.filter((item) => item.value > 0);
		let base = y(0);
		const marks = active.map((item, order) => {
			const height = (item.value / top) * innerHeight;
			const markTop = base - height;
			const drawn = height - (order === 0 ? 0 : GAP);
			base = markTop;
			return {
				key: item.entry.key,
				color: item.entry.color,
				x: x0,
				y: markTop,
				height: drawn,
				last: order === active.length - 1,
			};
		});
		return { index, marks };
	});

	const hovered = hover ? hover.index : null;
	const tooltip =
		hovered === null
			? null
			: {
					title: bucketTitle(hovered),
					rows: [...series]
						.reverse()
						.filter((entry) => (entry.values[hovered] ?? 0) > 0)
						.map((entry) => ({
							color: entry.color,
							value: format(entry.values[hovered] ?? 0),
							label: entry.name,
						})),
					footer: [totalLabel, format(totals[hovered] ?? 0)] as [
						string,
						string,
					],
				};

	return (
		<div ref={ref} className="relative w-full">
			<svg
				width={width}
				height={HEIGHT}
				viewBox={`0 0 ${width} ${HEIGHT}`}
				role="img"
				aria-label={ariaLabel}
				className="block overflow-visible"
			>
				{ticks.map((tick) => (
					<g key={tick}>
						{tick > 0 ? (
							<line
								x1={MARGIN.left}
								x2={width - MARGIN.right}
								y1={round2(y(tick))}
								y2={round2(y(tick))}
								stroke={palette.grid}
								shapeRendering="crispEdges"
							/>
						) : null}
						<text
							x={MARGIN.left - 8}
							y={round2(y(tick) + 4)}
							textAnchor="end"
							className="fill-muted-foreground text-[11px] tabular-nums"
						>
							{formatAxis(tick, step)}
						</text>
					</g>
				))}
				{columns.map((column) => (
					<g key={column.index}>
						<rect
							x={round2(MARGIN.left + slot * column.index)}
							y={MARGIN.top}
							width={round2(slot)}
							height={innerHeight}
							className="fill-foreground"
							opacity={hovered === column.index ? 0.05 : 0}
						/>
						{column.marks.map((mark) =>
							mark.height < 0.75 ? null : mark.last ? (
								<path
									key={mark.key}
									d={roundedTopPath(mark.x, mark.y, barWidth, mark.height)}
									fill={mark.color}
								/>
							) : (
								<rect
									key={mark.key}
									x={round2(mark.x)}
									y={round2(mark.y)}
									width={round2(barWidth)}
									height={round2(mark.height)}
									fill={mark.color}
								/>
							),
						)}
						<rect
							x={round2(MARGIN.left + slot * column.index)}
							y={MARGIN.top}
							width={round2(slot)}
							height={innerHeight}
							fill="transparent"
							tabIndex={0}
							aria-label={`${bucketTitle(column.index)}: ${format(totals[column.index] ?? 0)}`}
							className="outline-none"
							onPointerMove={(event) => {
								const box =
									event.currentTarget.ownerSVGElement?.getBoundingClientRect();
								setHover({
									index: column.index,
									x: box
										? event.clientX - box.left
										: MARGIN.left + slot * column.index,
									y: box ? event.clientY - box.top : MARGIN.top,
								});
							}}
							onFocus={() =>
								setHover({
									index: column.index,
									x: MARGIN.left + slot * (column.index + 0.5),
									y: y(totals[column.index] ?? 0),
								})
							}
							onPointerLeave={() => setHover(null)}
							onBlur={() => setHover(null)}
						/>
					</g>
				))}
				<line
					x1={MARGIN.left}
					x2={width - MARGIN.right}
					y1={round2(y(0))}
					y2={round2(y(0))}
					stroke={palette.axis}
					shapeRendering="crispEdges"
				/>
				{xLabels.map((index, position) => {
					const center = MARGIN.left + slot * (index + 0.5);
					const anchor =
						xLabels.length === 1
							? "middle"
							: position === 0
								? "start"
								: position === xLabels.length - 1
									? "end"
									: "middle";
					const labelX =
						anchor === "start"
							? center - barWidth / 2
							: anchor === "end"
								? center + barWidth / 2
								: center;
					return (
						<text
							key={index}
							x={round2(labelX)}
							y={HEIGHT - 8}
							textAnchor={anchor}
							className="fill-muted-foreground text-[11px]"
						>
							{bucketLabel(index)}
						</text>
					);
				})}
			</svg>
			{hover ? (
				<ChartTooltip content={tooltip} x={hover.x} y={hover.y} />
			) : null}
		</div>
	);
};
