import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { CostCoverage } from "../utils/usage-aggregate";
import { formatTokens } from "../utils/usage-format";
import type { UsageViewContext } from "./usage-view";

/** Money can be shared out and compared only where some request was priced. */
export const hasMoney = (view: UsageViewContext, coverage?: CostCoverage) =>
	view.metric !== "cost" || !coverage || coverage.priced;

/**
 * A row's value. With the cost measure: money the provider reported, plus the
 * tokens of requests that came back without a price; only tokens when nothing
 * was priced; "Free" when everything ran on-device.
 */
export const MetricCell: React.FC<{
	value: number;
	coverage?: CostCoverage;
	view: UsageViewContext;
	align?: "start" | "end";
}> = ({ value, coverage, view, align = "end" }) => {
	const { t } = useTranslation("usage");
	if (view.metric !== "cost" || !coverage) return <>{view.format(value)}</>;
	if (!coverage.remote) {
		return (
			<span className="font-medium text-emerald-600 dark:text-emerald-500">
				{t("summary.free")}
			</span>
		);
	}
	const tokens = formatTokens(coverage.unpricedTokens);
	const stack = cn(
		"inline-flex flex-col leading-tight",
		align === "start" ? "items-start" : "items-end",
	);
	if (!coverage.priced) {
		return (
			<span className={stack} title={t("summary.unpricedRow")}>
				<span>{tokens}</span>
				<span className="text-[10px] text-muted-foreground">
					{t("summary.tokensUnit")}
				</span>
			</span>
		);
	}
	if (coverage.unpricedTokens < 1) return <>{view.format(value)}</>;
	return (
		<span className={stack}>
			<span>{view.format(value)}</span>
			<span
				className="text-[10px] text-muted-foreground"
				title={t("summary.unpricedRow")}
			>
				{t("summary.plusTokens", { tokens })}
			</span>
		</span>
	);
};
