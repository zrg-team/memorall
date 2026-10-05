import React from "react";
import { useTranslation } from "react-i18next";
import type { UsageSlice } from "../types";
import {
	conversationTotals,
	costCoverageBy,
	requestWeights,
} from "../utils/usage-aggregate";
import {
	formatCount,
	formatShortDate,
	formatTokens,
	formatUsd,
} from "../utils/usage-format";
import { isModelUsageSession } from "@/services/model-usage/model-usage-ledger";
import { UsageCard } from "./chart-primitives";
import { MetricCell } from "./MetricCell";
import { UsageTable } from "./UsageTable";
import type { UsageViewContext } from "./usage-view";

const TOP = 8;
const DAY = 86_400_000;

export const ConversationTableCard: React.FC<{
	current: readonly UsageSlice[];
	view: UsageViewContext;
	onOpen?: (conversationId: string) => void;
}> = ({ current, view, onOpen }) => {
	const { t } = useTranslation("usage");
	const { metric, palette, locale } = view;
	const rows = React.useMemo(
		() =>
			conversationTotals(current, metric)
				.sort((a, b) => b.value - a.value)
				.slice(0, TOP),
		[current, metric],
	);
	const coverage = React.useMemo(
		() =>
			costCoverageBy(
				current,
				requestWeights((request) => request.conversationId),
			),
		[current],
	);
	// The cost column is always money, whichever measure ranks the rows.
	const costView: UsageViewContext = {
		...view,
		metric: "cost",
		format: formatUsd,
	};

	const lastActive = (at: number) => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const days = Math.floor((today.getTime() - at) / DAY) + 1;
		if (at >= today.getTime()) return t("conversations.today");
		if (days <= 1) return t("conversations.yesterday");
		if (days < 14) return t("conversations.daysAgo", { count: days });
		return formatShortDate(at, locale);
	};

	return (
		<UsageCard
			title={t("conversations.title")}
			subtitle={t(
				metric === "cost"
					? "conversations.subtitleCost"
					: "conversations.subtitleTokens",
				{
					count: rows.length,
				},
			)}
		>
			{!rows.length ? (
				<div className="py-8 text-center text-xs text-muted-foreground">
					{t("empty.filtered")}
				</div>
			) : (
				<UsageTable
					columns={[
						{ label: t("conversations.conversation") },
						{ label: t("conversations.model"), optional: true },
						{ label: t("tiles.requests"), numeric: true },
						{ label: t("measure.tokens"), numeric: true },
						{ label: t("measure.cost"), numeric: true },
						{
							label: t("conversations.lastActive"),
							numeric: true,
							optional: true,
						},
					]}
					rows={rows.map((row) => {
						// pi code and Studio sessions on a computer are no chat to open.
						const open = isModelUsageSession(row.conversationId)
							? undefined
							: onOpen;
						return {
							key: row.conversationId,
							title: open ? t("conversations.open") : undefined,
							onSelect: open ? () => open(row.conversationId) : undefined,
							cells: [
								<span key="name" className="flex min-w-0 items-center gap-2">
									<span
										className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
										style={{
											background:
												view.agentColors.get(row.agent) ?? palette.other,
										}}
									/>
									<span className="flex min-w-0 flex-col">
										<span className="truncate font-medium">
											{row.title || t("conversations.untitled")}
										</span>
										<span className="truncate text-[11px] text-muted-foreground">
											{view.agentLabel(row.agent)}
										</span>
									</span>
								</span>,
								<span key="model" className="whitespace-nowrap">
									<span className="font-mono text-[11px]">
										{view.modelLabel(row.model).name}
									</span>
									{row.models > 1 ? (
										<span className="text-muted-foreground">
											{" "}
											+{row.models - 1}
										</span>
									) : null}
								</span>,
								formatCount(row.requests),
								formatTokens(row.tokens),
								<MetricCell
									key="cost"
									value={row.cost}
									coverage={coverage.get(row.conversationId)}
									view={costView}
								/>,
								<span key="last" className="text-muted-foreground">
									{lastActive(row.lastAt)}
								</span>,
							],
						};
					})}
				/>
			)}
		</UsageCard>
	);
};
