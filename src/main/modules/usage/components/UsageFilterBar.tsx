import { X } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import type {
	UsageFilterKey,
	UsageFilters,
	UsageMetric,
	UsageRangeKey,
} from "../types";
import { SegmentedControl } from "./chart-primitives";

const ALL = "__all__";
const DEFAULT_AGENT = "__default__";

const RANGES: readonly UsageRangeKey[] = ["7d", "30d", "90d", "mtd"];

export const UsageFilterBar: React.FC<{
	range: UsageRangeKey;
	onRangeChange: (range: UsageRangeKey) => void;
	metric: UsageMetric;
	onMetricChange: (metric: UsageMetric) => void;
	filters: UsageFilters;
	onFilterChange: (key: UsageFilterKey, value: string | null) => void;
	onReset: () => void;
	agents: readonly string[];
	providers: readonly string[];
	agentLabel: (agent: string) => string;
	providerLabel: (group: string) => string;
	chipLabel: (key: UsageFilterKey, value: string) => string;
}> = ({
	range,
	onRangeChange,
	metric,
	onMetricChange,
	filters,
	onFilterChange,
	onReset,
	agents,
	providers,
	agentLabel,
	providerLabel,
	chipLabel,
}) => {
	const { t } = useTranslation("usage");
	const chips = (["model", "feature", "tool"] as const).filter(
		(key) => filters[key] !== null,
	);
	const filtered =
		filters.agent !== null || filters.provider !== null || chips.length > 0;

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 bg-muted/10 px-4 py-2.5">
			<SegmentedControl
				label={t("range.label")}
				value={range}
				onChange={onRangeChange}
				options={RANGES.map((value) => ({ value, label: t(`range.${value}`) }))}
			/>
			<Select
				value={
					filters.agent === null
						? ALL
						: filters.agent === ""
							? DEFAULT_AGENT
							: filters.agent
				}
				onValueChange={(value) =>
					onFilterChange(
						"agent",
						value === ALL ? null : value === DEFAULT_AGENT ? "" : value,
					)
				}
			>
				<SelectTrigger
					aria-label={t("filters.agent")}
					className="h-8 w-auto min-w-[136px] max-w-[220px] gap-2 text-xs"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={ALL}>{t("filters.allAgents")}</SelectItem>
					{agents.map((agent) => (
						<SelectItem
							key={agent || DEFAULT_AGENT}
							value={agent || DEFAULT_AGENT}
						>
							{agentLabel(agent)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select
				value={filters.provider ?? ALL}
				onValueChange={(value) =>
					onFilterChange("provider", value === ALL ? null : value)
				}
			>
				<SelectTrigger
					aria-label={t("filters.provider")}
					className="h-8 w-auto min-w-[136px] max-w-[220px] gap-2 text-xs"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={ALL}>{t("filters.allProviders")}</SelectItem>
					{providers.map((group) => (
						<SelectItem key={group} value={group}>
							{providerLabel(group)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<span className="inline-flex items-center gap-2">
				<span className="ml-1 text-[11px] text-muted-foreground">
					{t("measure.label")}
				</span>
				<SegmentedControl
					label={t("measure.label")}
					value={metric}
					onChange={onMetricChange}
					options={[
						{ value: "cost", label: t("measure.cost") },
						{ value: "tokens", label: t("measure.tokens") },
					]}
				/>
			</span>
			{chips.map((key) => {
				const value = filters[key] ?? "";
				return (
					<span
						key={key}
						className="inline-flex h-7 items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 pl-2.5 pr-1 text-xs font-medium text-blue-500"
					>
						<span className="font-normal opacity-75">
							{t(`filters.${key}`)}
						</span>
						<span className={key === "tool" ? "font-mono" : undefined}>
							{chipLabel(key, value)}
						</span>
						<button
							type="button"
							onClick={() => onFilterChange(key, null)}
							aria-label={t("filters.remove", { name: t(`filters.${key}`) })}
							className="rounded-full p-0.5 hover:bg-blue-500/15"
						>
							<X size={12} />
						</button>
					</span>
				);
			})}
			{filtered ? (
				<button
					type="button"
					onClick={onReset}
					className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
				>
					{t("filters.reset")}
				</button>
			) : null}
		</div>
	);
};
