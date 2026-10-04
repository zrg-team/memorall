import React from "react";
import { niceTicks } from "../utils/usage-format";
import {
	ChartTooltip,
	labelIndexes,
	round2,
	type TooltipContent,
	useElementWidth,
} from "./chart-primitives";
import type { UsagePalette } from "./usage-palette";

const HEIGHT = 236;
const MARGIN = { left: 52, right: 16, top: 24, bottom: 28 };

interface TrendChartProps {
	current: readonly number[];
	previous: readonly number[];
	/** Axis label for day i. */
	dayLabel: (index: number) => string;
	/** Tooltip title for day i, and the matching day of the previous period. */
	dayTitle: (index: number) => string;
	previousDayLabel: (index: number) => string;
	format: (value: number) => string;
	formatAxis: (value: number, step: number) => string;
	labels: {
		current: string;
		peak: string;
		ariaLabel: string;
		keyboard: string;
	};
	palette: UsagePalette;
}

/** This period as an area line, the previous period as a gray line beneath. */
export const TrendChart: React.FC<TrendChartProps> = ({
	current,
	previous,
	dayLabel,
	dayTitle,
	previousDayLabel,
	format,
	formatAxis,
	labels,
	palette,
}) => {
	const [ref, measured] = useElementWidth<HTMLDivElement>();
	const [hover, setHover] = React.useState<{
		index: number;
		x: number;
		y: number;
	} | null>(null);
	const width = Math.max(260, measured);
	const count = current.length;
	const innerWidth = width - MARGIN.left - MARGIN.right;
	const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
	const { ticks, top, step } = niceTicks(Math.max(...current, ...previous, 0));
	const x = (index: number) =>
		MARGIN.left +
		(count <= 1 ? innerWidth / 2 : (index * innerWidth) / (count - 1));
	const y = (value: number) =>
		MARGIN.top + innerHeight - (value / top) * innerHeight;
	const line = (values: readonly number[]) =>
		values
			.map(
				(value, index) =>
					`${index ? "L" : "M"}${round2(x(index))},${round2(y(value))}`,
			)
			.join("");

	const peakIndex = current.indexOf(Math.max(...current));
	const peakValue = current[peakIndex] ?? 0;
	const xLabels = labelIndexes(
		count,
		Math.max(2, Math.min(6, Math.floor(innerWidth / 90))),
	);

	const indexAt = (clientX: number, element: Element) => {
		const box = element.getBoundingClientRect();
		if (count <= 1) return 0;
		const raw = Math.round(
			((clientX - box.left - MARGIN.left) / innerWidth) * (count - 1),
		);
		return Math.max(0, Math.min(count - 1, raw));
	};

	const tooltip: TooltipContent | null = hover
		? {
				title: dayTitle(hover.index),
				rows: [
					{
						color: palette.series[0] ?? palette.other,
						value: format(current[hover.index] ?? 0),
						label: labels.current,
					},
					{
						color: palette.previous,
						value: format(previous[hover.index] ?? 0),
						label: previousDayLabel(hover.index),
					},
				],
			}
		: null;
	const accent = palette.series[0] ?? palette.other;

	return (
		<div ref={ref} className="relative w-full">
			<svg
				width={width}
				height={HEIGHT}
				viewBox={`0 0 ${width} ${HEIGHT}`}
				role="img"
				aria-label={labels.ariaLabel}
				className="block overflow-visible"
			>
				{ticks.map((tick) => (
					<g key={tick}>
						<line
							x1={MARGIN.left}
							x2={width - MARGIN.right}
							y1={round2(y(tick))}
							y2={round2(y(tick))}
							stroke={tick === 0 ? palette.axis : palette.grid}
							shapeRendering="crispEdges"
						/>
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
				{xLabels.map((index, position) => (
					<text
						key={index}
						x={round2(x(index))}
						y={HEIGHT - 8}
						textAnchor={
							xLabels.length === 1
								? "middle"
								: position === 0
									? "start"
									: position === xLabels.length - 1
										? "end"
										: "middle"
						}
						className="fill-muted-foreground text-[11px]"
					>
						{dayLabel(index)}
					</text>
				))}
				<path
					d={line(previous)}
					fill="none"
					stroke={palette.previous}
					strokeWidth={2}
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				<path
					d={`${line(current)}L${round2(x(count - 1))},${round2(y(0))}L${round2(x(0))},${round2(y(0))}Z`}
					fill={accent}
					opacity={0.1}
				/>
				<path
					d={line(current)}
					fill="none"
					stroke={accent}
					strokeWidth={2}
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				{count > 2 && peakValue > 0 ? (
					<g>
						<circle
							cx={round2(x(peakIndex))}
							cy={round2(y(peakValue))}
							r={4}
							fill={accent}
							stroke={palette.surface}
							strokeWidth={2}
						/>
						<text
							x={round2(x(peakIndex))}
							y={round2(y(peakValue) - 10)}
							textAnchor={
								x(peakIndex) < MARGIN.left + 70
									? "start"
									: x(peakIndex) > width - MARGIN.right - 70
										? "end"
										: "middle"
							}
							className="fill-foreground/80 text-[11px] font-medium"
						>
							{`${labels.peak} ${format(peakValue)} · ${dayLabel(peakIndex)}`}
						</text>
					</g>
				) : null}
				{count > 0 && peakIndex !== count - 1 ? (
					<circle
						cx={round2(x(count - 1))}
						cy={round2(y(current[count - 1] ?? 0))}
						r={4}
						fill={accent}
						stroke={palette.surface}
						strokeWidth={2}
					/>
				) : null}
				{hover ? (
					<g>
						<line
							x1={round2(x(hover.index))}
							x2={round2(x(hover.index))}
							y1={MARGIN.top}
							y2={MARGIN.top + innerHeight}
							className="stroke-muted-foreground"
							shapeRendering="crispEdges"
						/>
						<circle
							cx={round2(x(hover.index))}
							cy={round2(y(previous[hover.index] ?? 0))}
							r={4}
							fill={palette.previous}
							stroke={palette.surface}
							strokeWidth={2}
						/>
						<circle
							cx={round2(x(hover.index))}
							cy={round2(y(current[hover.index] ?? 0))}
							r={4}
							fill={accent}
							stroke={palette.surface}
							strokeWidth={2}
						/>
					</g>
				) : null}
				<rect
					x={MARGIN.left - 6}
					y={MARGIN.top}
					width={innerWidth + 12}
					height={innerHeight}
					fill="transparent"
					tabIndex={0}
					aria-label={labels.keyboard}
					className="outline-none"
					onPointerMove={(event) => {
						const index = indexAt(
							event.clientX,
							event.currentTarget.ownerSVGElement ?? event.currentTarget,
						);
						setHover({ index, x: x(index), y: y(current[index] ?? 0) });
					}}
					onPointerLeave={() => setHover(null)}
					onFocus={() =>
						setHover({
							index: count - 1,
							x: x(count - 1),
							y: y(current[count - 1] ?? 0),
						})
					}
					onBlur={() => setHover(null)}
					onKeyDown={(event) => {
						if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
						event.preventDefault();
						const from = hover?.index ?? count - 1;
						const index = Math.max(
							0,
							Math.min(count - 1, from + (event.key === "ArrowLeft" ? -1 : 1)),
						);
						setHover({ index, x: x(index), y: y(current[index] ?? 0) });
					}}
				/>
			</svg>
			{hover ? (
				<ChartTooltip content={tooltip} x={hover.x} y={hover.y} />
			) : null}
		</div>
	);
};
