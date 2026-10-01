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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/main/components/ui/table";
import {
	ProgressiveCollectionControl,
	useProgressiveItems,
} from "../progressive-collection";
import { tableArgs } from "../table-args";

const chartColors = [
	"hsl(var(--primary))",
	"#2563eb",
	"#16a34a",
	"#ea580c",
	"#9333ea",
	"#0891b2",
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
		const rows = useProgressiveItems(table.rows);
		return (
			<div className="overflow-hidden rounded-lg border">
				{table.title ? (
					<div className="border-b px-3 py-2 text-sm font-medium">
						{table.title}
					</div>
				) : null}
				<Table>
					<TableHeader>
						<TableRow>
							{table.columns.map((column, index) => (
								<TableHead
									key={`${column.header}-${index}`}
									className={
										column.align === "right"
											? "text-right"
											: column.align === "center"
												? "text-center"
												: undefined
									}
								>
									{column.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.items.map((row, rowIndex) => (
							<TableRow key={rowIndex}>
								{row.map((cell, cellIndex) => {
									const column = table.columns[cellIndex];
									return (
										<TableCell
											key={`${rowIndex}-${cellIndex}`}
											className={
												column?.align === "right"
													? "text-right"
													: column?.align === "center"
														? "text-center"
														: undefined
											}
										>
											{cell}
										</TableCell>
									);
								})}
							</TableRow>
						))}
					</TableBody>
				</Table>
				<ProgressiveCollectionControl
					hiddenCount={rows.hiddenCount}
					onRenderAll={rows.renderAll}
				/>
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

const singleSeriesConfig: ChartConfig = {
	value: { label: "Value", color: chartColors[0] },
};

export const BarChartBlock = defineComponent({
	name: "BarChartBlock",
	description: "Vertical bar chart for category comparisons.",
	props: z.object({
		title: z.string().optional(),
		data: chartDataSchema,
	}),
	component: ({ props }) => (
		<div className="space-y-2">
			{props.title ? (
				<div className="text-sm font-medium">{props.title}</div>
			) : null}
			<ChartContainer config={singleSeriesConfig} className="h-56 w-full">
				<BarChart data={props.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey="label" tickLine={false} axisLine={false} />
					<YAxis tickLine={false} axisLine={false} width={36} />
					<Bar
						dataKey="value"
						fill="var(--color-value)"
						radius={[4, 4, 0, 0]}
					/>
				</BarChart>
			</ChartContainer>
		</div>
	),
});

export const LineChartBlock = defineComponent({
	name: "LineChartBlock",
	description: "Line chart for trends over time or ordered categories.",
	props: z.object({
		title: z.string().optional(),
		data: chartDataSchema,
	}),
	component: ({ props }) => (
		<div className="space-y-2">
			{props.title ? (
				<div className="text-sm font-medium">{props.title}</div>
			) : null}
			<ChartContainer config={singleSeriesConfig} className="h-56 w-full">
				<LineChart data={props.data}>
					<CartesianGrid vertical={false} />
					<XAxis dataKey="label" tickLine={false} axisLine={false} />
					<YAxis tickLine={false} axisLine={false} width={36} />
					<Line
						type="monotone"
						dataKey="value"
						stroke="var(--color-value)"
						strokeWidth={2}
						dot={{ r: 3 }}
					/>
				</LineChart>
			</ChartContainer>
		</div>
	),
});

export const PieChartBlock = defineComponent({
	name: "PieChartBlock",
	description: "Pie chart for proportions.",
	props: z.object({
		title: z.string().optional(),
		data: chartDataSchema,
	}),
	component: ({ props }) => (
		<div className="space-y-2">
			{props.title ? (
				<div className="text-sm font-medium">{props.title}</div>
			) : null}
			<ChartContainer config={singleSeriesConfig} className="h-56 w-full">
				<PieChart>
					<Pie
						data={props.data}
						dataKey="value"
						nameKey="label"
						innerRadius={48}
						outerRadius={82}
						paddingAngle={2}
					>
						{props.data.map((entry, index) => (
							<Cell
								key={entry.label}
								fill={chartColors[index % chartColors.length]}
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
