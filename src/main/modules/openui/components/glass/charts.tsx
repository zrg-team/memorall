import React from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	Pie,
	PieChart,
	XAxis,
	YAxis,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/main/components/ui/chart";
import { tableArgs } from "../table-args";

const chartColors = [
	"rgba(255,255,255,0.7)",
	"rgba(147,197,253,0.7)",
	"rgba(134,239,172,0.7)",
	"rgba(253,186,116,0.7)",
	"rgba(216,180,254,0.7)",
	"rgba(103,232,249,0.7)",
];

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
			<div className="overflow-hidden rounded-xl border border-white/15 backdrop-blur-sm">
				{table.title ? (
					<div className="border-b border-white/15 px-3 py-2 text-sm font-semibold">
						{table.title}
					</div>
				) : null}
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-white/15 bg-white/10">
							{table.columns.map((col, i) => (
								<th
									key={i}
									className={`px-3 py-2 font-semibold ${
										col.align === "right"
											? "text-right"
											: col.align === "center"
												? "text-center"
												: "text-left"
									}`}
								>
									{col.header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{table.rows.map((row, ri) => (
							<tr
								key={ri}
								className="border-b border-white/10 bg-white/5 last:border-0 hover:bg-white/10 transition-colors"
							>
								{row.map((cell, ci) => {
									const col = table.columns[ci];
									return (
										<td
											key={ci}
											className={`px-3 py-2 ${
												col?.align === "right"
													? "text-right"
													: col?.align === "center"
														? "text-center"
														: ""
											}`}
										>
											{cell}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	},
});

const chartDataSchema = z.array(
	z.object({ label: z.string(), value: z.number() }),
);

const glassChartConfig: ChartConfig = {
	value: { label: "Value", color: chartColors[0] },
};

export const BarChartBlock = defineComponent({
	name: "BarChartBlock",
	description: "Vertical bar chart for category comparisons.",
	props: z.object({ title: z.string().optional(), data: chartDataSchema }),
	component: ({ props }) => (
		<div className="space-y-2 rounded-xl border border-white/15 bg-white/5 p-3 backdrop-blur-sm">
			{props.title ? (
				<div className="text-sm font-medium">{props.title}</div>
			) : null}
			<ChartContainer config={glassChartConfig} className="h-56 w-full">
				<BarChart data={props.data}>
					<CartesianGrid vertical={false} stroke="rgba(255,255,255,0.1)" />
					<XAxis
						dataKey="label"
						tickLine={false}
						axisLine={false}
						tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						width={36}
						tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
					/>
					<Bar
						dataKey="value"
						fill="rgba(255,255,255,0.3)"
						radius={[6, 6, 0, 0]}
						stroke="rgba(255,255,255,0.4)"
						strokeWidth={1}
					/>
				</BarChart>
			</ChartContainer>
		</div>
	),
});

export const LineChartBlock = defineComponent({
	name: "LineChartBlock",
	description: "Line chart for trends over time or ordered categories.",
	props: z.object({ title: z.string().optional(), data: chartDataSchema }),
	component: ({ props }) => (
		<div className="space-y-2 rounded-xl border border-white/15 bg-white/5 p-3 backdrop-blur-sm">
			{props.title ? (
				<div className="text-sm font-medium">{props.title}</div>
			) : null}
			<ChartContainer config={glassChartConfig} className="h-56 w-full">
				<LineChart data={props.data}>
					<CartesianGrid vertical={false} stroke="rgba(255,255,255,0.1)" />
					<XAxis
						dataKey="label"
						tickLine={false}
						axisLine={false}
						tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						width={36}
						tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }}
					/>
					<Line
						type="monotone"
						dataKey="value"
						stroke="rgba(255,255,255,0.7)"
						strokeWidth={2}
						dot={{ r: 3, fill: "rgba(255,255,255,0.5)", strokeWidth: 0 }}
					/>
				</LineChart>
			</ChartContainer>
		</div>
	),
});

export const PieChartBlock = defineComponent({
	name: "PieChartBlock",
	description: "Pie chart for proportions.",
	props: z.object({ title: z.string().optional(), data: chartDataSchema }),
	component: ({ props }) => (
		<div className="space-y-2 rounded-xl border border-white/15 bg-white/5 p-3 backdrop-blur-sm">
			{props.title ? (
				<div className="text-sm font-medium">{props.title}</div>
			) : null}
			<ChartContainer config={glassChartConfig} className="h-56 w-full">
				<PieChart>
					<Pie
						data={props.data}
						dataKey="value"
						nameKey="label"
						innerRadius={48}
						outerRadius={82}
						paddingAngle={3}
					>
						{props.data.map((entry, index) => (
							<Cell
								key={entry.label}
								fill={chartColors[index % chartColors.length]}
								stroke="rgba(255,255,255,0.2)"
								strokeWidth={1}
							/>
						))}
					</Pie>
				</PieChart>
			</ChartContainer>
		</div>
	),
});

export const chartComponents = [
	Col,
	TableBlock,
	BarChartBlock,
	LineChartBlock,
	PieChartBlock,
];
