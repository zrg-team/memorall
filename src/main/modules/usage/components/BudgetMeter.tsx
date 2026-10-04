import { CircleCheck, Pencil, TriangleAlert, Wallet } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import { formatUsd } from "../utils/usage-format";
import type { UsagePalette } from "./usage-palette";

/** Month-to-date spend against the monthly budget, with the month-end projection. */
export const BudgetMeter: React.FC<{
	budget: number | null;
	spend: number | null;
	onBudgetChange: (value: number | null) => void;
	palette: UsagePalette;
	locale: string;
}> = ({ budget, spend, onBudgetChange, palette, locale }) => {
	const { t } = useTranslation("usage");
	const [open, setOpen] = React.useState(false);
	const [draft, setDraft] = React.useState("");

	const now = new Date();
	const daysInMonth = new Date(
		now.getFullYear(),
		now.getMonth() + 1,
		0,
	).getDate();
	const monthSpend = spend ?? 0;
	const projected = (monthSpend / now.getDate()) * daysInMonth;
	const month = now.toLocaleDateString(locale, { month: "long" });

	const editor = (
		<PopoverContent align="end" className="w-64 p-3">
			<form
				className="flex flex-col gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const value = Number.parseFloat(draft);
					onBudgetChange(Number.isFinite(value) && value > 0 ? value : null);
					setOpen(false);
				}}
			>
				<label htmlFor="usage-budget" className="text-xs font-medium">
					{t("budget.label")}
				</label>
				<Input
					id="usage-budget"
					type="number"
					inputMode="decimal"
					min="0"
					step="0.5"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="20"
					className="h-8 text-sm"
					autoFocus
				/>
				<p className="m-0 text-[11px] text-muted-foreground">
					{t("budget.hint")}
				</p>
				<div className="flex justify-end gap-2">
					{budget !== null ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								onBudgetChange(null);
								setOpen(false);
							}}
						>
							{t("budget.clear")}
						</Button>
					) : null}
					<Button type="submit" size="sm" variant="outline">
						{t("budget.save")}
					</Button>
				</div>
			</form>
		</PopoverContent>
	);

	const onOpenChange = (next: boolean) => {
		if (next) setDraft(budget ? String(budget) : "");
		setOpen(next);
	};

	if (budget === null) {
		return (
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger asChild>
					<Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
						<Wallet size={14} />
						{t("budget.set")}
					</Button>
				</PopoverTrigger>
				{editor}
			</Popover>
		);
	}

	const over = projected > budget;
	const used = Math.min(100, (monthSpend / budget) * 100);
	const projectedAt = Math.min(100, (projected / budget) * 100);
	const StatusIcon = over ? TriangleAlert : CircleCheck;

	return (
		<div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background py-1.5 pl-3 pr-1.5">
			<div className="flex min-w-0 flex-col gap-1">
				<div className="flex items-baseline gap-1.5 text-xs">
					<span className="text-muted-foreground">
						{t("budget.month", { month })}
					</span>
					<b className="font-semibold tabular-nums">{formatUsd(monthSpend)}</b>
					<span className="text-muted-foreground">
						{t("budget.of", { budget: formatUsd(budget) })}
					</span>
				</div>
				<div
					role="meter"
					aria-label={t("budget.meter")}
					aria-valuemin={0}
					aria-valuemax={budget}
					aria-valuenow={Math.round(monthSpend * 100) / 100}
					className="relative h-1.5 w-44 rounded-full"
					style={{ background: palette.meterTrack }}
				>
					<span
						className="absolute inset-y-0 left-0 rounded-full"
						style={{
							width: `${used}%`,
							background: over ? palette.warning : palette.meterFill,
						}}
					/>
					<span
						title={t("budget.projectedMarker")}
						className="absolute -top-[3px] h-3 w-0.5 rounded-sm bg-foreground/55"
						style={{ left: `calc(${projectedAt}% - 1px)` }}
					/>
				</div>
				<div className="flex items-center gap-1 text-[11px] text-muted-foreground">
					<StatusIcon
						size={12}
						style={{ color: over ? palette.warning : palette.good }}
					/>
					{over
						? t("budget.over", {
								projected: formatUsd(projected),
								over: formatUsd(projected - budget),
							})
						: t("budget.onTrack", { projected: formatUsd(projected) })}
				</div>
			</div>
			<Popover open={open} onOpenChange={onOpenChange}>
				<PopoverTrigger asChild>
					<Button
						size="icon"
						variant="ghost"
						className="h-7 w-7"
						aria-label={t("budget.edit")}
						title={t("budget.edit")}
					>
						<Pencil size={14} />
					</Button>
				</PopoverTrigger>
				{editor}
			</Popover>
		</div>
	);
};
