import type React from "react";
import { cn } from "@/lib/utils";

export interface UsageTableColumn {
	label: React.ReactNode;
	numeric?: boolean;
	/** Hidden when the card is narrow. */
	optional?: boolean;
}

export interface UsageTableRow {
	key: string;
	cells: React.ReactNode[];
	selected?: boolean;
	onSelect?: () => void;
	title?: string;
}

/** Plain data table: the table twin of each chart, and the tool / chat lists. */
export const UsageTable: React.FC<{
	columns: readonly UsageTableColumn[];
	rows: readonly UsageTableRow[];
	capped?: boolean;
}> = ({ columns, rows, capped }) => (
	<div className={cn("overflow-auto", capped && "max-h-72")}>
		<table className="w-full border-collapse text-xs">
			<thead>
				<tr>
					{columns.map((column, index) => (
						<th
							// biome-ignore lint/suspicious/noArrayIndexKey: columns are static
							key={index}
							className={cn(
								"sticky top-0 z-[1] whitespace-nowrap border-b border-border bg-background px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
								column.numeric ? "text-right" : "text-left",
								column.optional && "hidden @xl:table-cell",
							)}
						>
							{column.label}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr
						key={row.key}
						title={row.title}
						aria-selected={row.onSelect ? Boolean(row.selected) : undefined}
						tabIndex={row.onSelect ? 0 : undefined}
						onClick={row.onSelect}
						onKeyDown={
							row.onSelect
								? (event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											row.onSelect?.();
										}
									}
								: undefined
						}
						className={cn(
							"border-t border-border/40 first:border-t-0 hover:bg-muted/50",
							row.onSelect &&
								"cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none",
							row.selected && "bg-blue-500/10 hover:bg-blue-500/10",
						)}
					>
						{row.cells.map((cell, index) => {
							const column = columns[index];
							return (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: cells follow the static columns
									key={index}
									className={cn(
										"px-2 py-2 align-middle",
										column?.numeric &&
											"whitespace-nowrap text-right tabular-nums",
										column?.optional && "hidden @xl:table-cell",
									)}
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
