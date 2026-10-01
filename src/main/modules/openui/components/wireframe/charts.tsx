import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { tableArgs } from "../table-args";

export const Col = defineComponent({
	name: "Col",
	description: "Table column definition.",
	props: z.object({
		header: z.string(),
		align: z.enum(["left", "right", "center"]).default("left"),
	}),
	component: () => null,
});

export const TableBlock = defineComponent({
	name: "TableBlock",
	description: "Compact table with columns and 2D string row data.",
	props: z.object({
		columns: z.array(Col.ref),
		rows: z.array(z.array(z.string())),
		// Holds the rows when a title comes first: TableBlock("Title", columns, rows).
		rowsAfterTitle: z.array(z.array(z.string())).optional(),
	}),
	component: ({ props }) => {
		const table = tableArgs(props);
		return (
			<div className="overflow-x-auto border-2 border-dashed border-foreground/40 font-mono">
				{table.title ? (
					<div className="border-b border-dashed border-foreground/40 px-3 py-2 text-sm font-semibold">
						[{table.title}]
					</div>
				) : null}
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-dashed border-foreground/40">
							{table.columns.map((col, i) => (
								<th key={i} className="px-3 py-2 text-left font-semibold">
									{col.header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{table.rows.map((row, ri) => (
							<tr
								key={ri}
								className="border-b border-dashed border-foreground/20 last:border-0"
							>
								{row.map((cell, ci) => (
									<td key={ci} className="px-3 py-2">
										{cell}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	},
});

const chartDataSchema = z.array(
	z.object({
		label: z.string(),
		value: z.number(),
	}),
);

export const BarChartBlock = defineComponent({
	name: "BarChartBlock",
	description: "Vertical bar chart for category comparisons.",
	props: z.object({
		title: z.string().optional(),
		data: chartDataSchema,
	}),
	component: ({ props }) => {
		const max = Math.max(...props.data.map((d) => d.value), 1);
		const barHeight = 8;
		return (
			<div className="space-y-2 font-mono">
				{props.title ? (
					<div className="text-sm font-semibold">[{props.title}]</div>
				) : null}
				<div className="space-y-1">
					{props.data.map((item, i) => {
						const bars = Math.round((item.value / max) * 20);
						return (
							<div key={i} className="flex items-center gap-2 text-xs">
								<span className="w-20 truncate text-right text-foreground/70">
									{item.label}
								</span>
								<span className="text-foreground/40">│</span>
								<span>{"█".repeat(bars)}</span>
								<span className="text-foreground/60">{item.value}</span>
							</div>
						);
					})}
				</div>
			</div>
		);
	},
});

export const LineChartBlock = defineComponent({
	name: "LineChartBlock",
	description: "Line chart for trends over time or ordered categories.",
	props: z.object({
		title: z.string().optional(),
		data: chartDataSchema,
	}),
	component: ({ props }) => {
		const max = Math.max(...props.data.map((d) => d.value), 1);
		return (
			<div className="space-y-2 font-mono">
				{props.title ? (
					<div className="text-sm font-semibold">[{props.title}]</div>
				) : null}
				<div className="border-2 border-dashed border-foreground/30 p-3">
					<div className="text-xs text-foreground/50 mb-1">trend ↗</div>
					<div className="flex items-end gap-1 h-12">
						{props.data.map((item, i) => {
							const h = Math.round((item.value / max) * 10);
							return (
								<div
									key={i}
									className="flex flex-col items-center gap-0.5 flex-1"
								>
									<div
										className="w-full border-t-2 border-foreground/60"
										style={{ marginTop: `${(10 - h) * 4}px` }}
									/>
									<span className="text-[9px] text-foreground/40 truncate w-full text-center">
										{item.label}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		);
	},
});

export const PieChartBlock = defineComponent({
	name: "PieChartBlock",
	description: "Pie chart for proportions.",
	props: z.object({
		title: z.string().optional(),
		data: chartDataSchema,
	}),
	component: ({ props }) => {
		const total = props.data.reduce((s, d) => s + d.value, 0) || 1;
		return (
			<div className="space-y-2 font-mono">
				{props.title ? (
					<div className="text-sm font-semibold">[{props.title}]</div>
				) : null}
				<div className="border-2 border-dashed border-foreground/30 p-3 space-y-1">
					{props.data.map((item, i) => {
						const pct = Math.round((item.value / total) * 100);
						const bars = Math.round(pct / 5);
						return (
							<div key={i} className="flex items-center gap-2 text-xs">
								<span className="w-20 truncate text-foreground/70">
									{item.label}
								</span>
								<span>
									{"▓".repeat(bars)}
									{"░".repeat(20 - bars)}
								</span>
								<span className="text-foreground/60">{pct}%</span>
							</div>
						);
					})}
				</div>
			</div>
		);
	},
});

export const chartComponents = [
	Col,
	TableBlock,
	BarChartBlock,
	LineChartBlock,
	PieChartBlock,
];
