import React from "react";
import { cn } from "@/lib/utils";
import type { UsagePalette } from "./usage-palette";

/** Width of an element, kept current as the panel resizes. */
export const useElementWidth = <T extends HTMLElement>() => {
	const ref = React.useRef<T>(null);
	const [width, setWidth] = React.useState(0);
	React.useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		setWidth(Math.floor(element.clientWidth));
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() =>
			setWidth(Math.floor(element.clientWidth)),
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, width] as const;
};

export const round2 = (value: number) => Math.round(value * 100) / 100;

/** Column with a 4px rounded top and a square base. */
export const roundedTopPath = (
	x: number,
	y: number,
	width: number,
	height: number,
	radius = 4,
) => {
	const r = Math.min(radius, height, width / 2);
	return `M${round2(x)},${round2(y + height)}V${round2(y + r)}A${r},${r} 0 0 1 ${round2(x + r)},${round2(y)}H${round2(x + width - r)}A${r},${r} 0 0 1 ${round2(x + width)},${round2(y + r)}V${round2(y + height)}Z`;
};

/** Indexes of up to `max` evenly spaced axis labels. */
export const labelIndexes = (count: number, max: number): number[] => {
	const labels = Math.min(count, max);
	if (count <= 1 || labels < 2) return [Math.max(0, count - 1)];
	return Array.from({ length: labels }, (_, index) =>
		Math.round((index * (count - 1)) / (labels - 1)),
	);
};

export const Sparkline: React.FC<{
	values: readonly number[];
	color: string;
	palette: UsagePalette;
	width?: number;
	height?: number;
}> = ({ values, color, palette, width = 64, height = 22 }) => {
	if (values.length < 2) return null;
	const max = Math.max(...values) || 1;
	const x = (index: number) => 2 + (index * (width - 7)) / (values.length - 1);
	const y = (value: number) => height - 3 - (value / max) * (height - 6);
	const points = values
		.map((value, index) => `${round2(x(index))},${round2(y(value))}`)
		.join(" ");
	const last = values.length - 1;
	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			aria-hidden="true"
			className="block shrink-0"
		>
			<polyline
				points={points}
				fill="none"
				stroke={palette.spark}
				strokeWidth={1.5}
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
			<circle
				cx={round2(x(last))}
				cy={round2(y(values[last] ?? 0))}
				r={2.5}
				fill={color}
			/>
		</svg>
	);
};

export interface TooltipRow {
	color: string;
	value: string;
	label: string;
}

export interface TooltipContent {
	title: string;
	rows: TooltipRow[];
	footer?: [string, string];
}

/**
 * Hover readout positioned inside its chart: value first, series name second,
 * keyed by a short stroke of the series color.
 */
export const ChartTooltip: React.FC<{
	content: TooltipContent | null;
	x: number;
	y: number;
}> = ({ content, x, y }) => {
	const ref = React.useRef<HTMLDivElement>(null);
	const [position, setPosition] = React.useState({ left: x, top: y });
	React.useLayoutEffect(() => {
		const element = ref.current;
		const parent = element?.offsetParent as HTMLElement | null;
		if (!element || !parent) return;
		const width = element.offsetWidth;
		const height = element.offsetHeight;
		let left = x + 14;
		let top = y + 14;
		if (left + width > parent.clientWidth) left = x - width - 14;
		if (top + height > parent.clientHeight + 40) top = y - height - 14;
		setPosition({ left: Math.max(0, left), top: Math.max(-40, top) });
	}, [x, y, content]);
	if (!content) return null;
	return (
		<div
			ref={ref}
			role="tooltip"
			className="pointer-events-none absolute z-20 min-w-[168px] max-w-[300px] rounded-lg border border-border bg-popover px-2.5 py-2 text-xs shadow-lg"
			style={{ left: position.left, top: position.top }}
		>
			<div className="mb-1.5 text-[11px] text-muted-foreground">
				{content.title}
			</div>
			{content.rows.map((row) => (
				<div
					key={`${row.label}-${row.color}`}
					className="grid grid-cols-[12px_auto_minmax(0,1fr)] items-center gap-2 py-px"
				>
					<span
						className="h-0.5 w-3 rounded-full"
						style={{ background: row.color }}
					/>
					<span className="text-right font-semibold tabular-nums">
						{row.value}
					</span>
					<span className="truncate text-muted-foreground">{row.label}</span>
				</div>
			))}
			{content.footer ? (
				<div className="mt-1.5 flex justify-between gap-3 border-t border-border pt-1.5 text-muted-foreground">
					<span>{content.footer[0]}</span>
					<b className="font-semibold tabular-nums text-foreground">
						{content.footer[1]}
					</b>
				</div>
			) : null}
		</div>
	);
};

export interface SegmentOption<V extends string> {
	value: V;
	label: string;
}

export const SegmentedControl = <V extends string>({
	value,
	options,
	onChange,
	label,
	size = "md",
}: {
	value: V;
	options: readonly SegmentOption<V>[];
	onChange: (value: V) => void;
	label: string;
	size?: "sm" | "md";
}) => (
	<div
		role="radiogroup"
		aria-label={label}
		className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5"
	>
		{options.map((option) => {
			const active = option.value === value;
			return (
				<button
					key={option.value}
					type="button"
					role="radio"
					aria-checked={active}
					onClick={() => onChange(option.value)}
					className={cn(
						"whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs",
						active
							? "bg-background text-foreground shadow-sm ring-1 ring-border/70 dark:bg-accent dark:ring-white/10"
							: "text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-accent/50",
					)}
				>
					{option.label}
				</button>
			);
		})}
	</div>
);

export const UsageCard: React.FC<{
	title: string;
	subtitle?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
}> = ({ title, subtitle, actions, className, children }) => (
	<section
		className={cn(
			"@container min-w-0 rounded-2xl border border-border/60 bg-background p-4 shadow-sm",
			className,
		)}
	>
		<div className="mb-3 flex items-start justify-between gap-3">
			<div className="min-w-0">
				<h3 className="text-sm font-semibold">{title}</h3>
				{subtitle ? (
					<div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
				) : null}
			</div>
			{actions}
		</div>
		{children}
	</section>
);

export const Legend: React.FC<{
	items: ReadonlyArray<{ key: string; name: string; color: string }>;
	shape?: "rect" | "line";
}> = ({ items, shape = "rect" }) =>
	items.length > 1 ? (
		<div className="mb-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
			{items.map((item) => (
				<span key={item.key} className="inline-flex items-center gap-1.5">
					<i
						className={cn(
							"inline-block",
							shape === "rect"
								? "h-2.5 w-2.5 rounded-[3px]"
								: "h-0.5 w-3.5 rounded-full",
						)}
						style={{ background: item.color }}
					/>
					{item.name}
				</span>
			))}
		</div>
	) : null;

export const ChangeText: React.FC<{
	current: number;
	previous: number;
	/** -1: up is bad (spend). 1: up is good. 0: neutral (volume). */
	polarity: -1 | 0 | 1;
	palette: UsagePalette;
	newLabel: string;
	className?: string;
}> = ({ current, previous, polarity, palette, newLabel, className }) => {
	let text = "—";
	let color: string | undefined;
	if (previous > 0) {
		const change = (current - previous) / previous;
		if (Math.abs(change) < 0.005) text = "0%";
		else {
			const size = Math.abs(change * 100);
			text = `${change > 0 ? "▲" : "▼"} ${size >= 999 ? "999+" : size.toFixed(size < 10 ? 1 : 0)}%`;
			if (polarity !== 0) {
				color =
					change > 0 === polarity > 0 ? palette.goodText : palette.badText;
			}
		}
	} else if (current > 0) text = newLabel;
	return (
		<span
			className={cn(
				"whitespace-nowrap text-[11px] font-medium tabular-nums",
				!color && "text-muted-foreground",
				className,
			)}
			style={color ? { color } : undefined}
		>
			{text}
		</span>
	);
};
