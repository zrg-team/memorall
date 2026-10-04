import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { UsageSlice } from "../types";
import {
	costCoverageBy,
	providerGroupOf,
	requestWeights,
	requestTokens,
	sumSlices,
	totalSeries,
	totalsBy,
} from "../utils/usage-aggregate";
import {
	formatCount,
	formatPercent,
	formatTokens,
	formatUsd,
	formatUsdPrecise,
} from "../utils/usage-format";
import { ChangeText, Sparkline } from "./chart-primitives";
import { MetricCell } from "./MetricCell";
import type { UsageViewContext } from "./usage-view";

const spendOf = (slice: UsageSlice) => (slice.request.cost ?? 0) * slice.factor;
const tokensOf = (slice: UsageSlice) =>
	requestTokens(slice.request) * slice.factor;
const conversationsOf = (slices: readonly UsageSlice[]) =>
	new Set(slices.map((slice) => slice.request.conversationId)).size;

const Tile: React.FC<{
	label: string;
	value: string;
	sub: string;
	change: React.ReactNode;
	spark?: readonly number[];
	view: UsageViewContext;
}> = ({ label, value, sub, change, spark, view }) => (
	<div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border/60 bg-background px-3.5 py-3">
		<div className="text-xs text-muted-foreground">{label}</div>
		<div className="text-[22px] font-semibold leading-tight">{value}</div>
		<div className="mt-auto flex items-end justify-between gap-2">
			<div className="min-w-0 text-[11px] text-muted-foreground">
				<div>{change}</div>
				<div className="truncate">{sub}</div>
			</div>
			{spark ? (
				<Sparkline
					values={spark}
					color={view.palette.series[0] ?? view.palette.other}
					palette={view.palette}
				/>
			) : null}
		</div>
	</div>
);

export const SummaryCards: React.FC<{
	current: readonly UsageSlice[];
	previous: readonly UsageSlice[];
	view: UsageViewContext;
}> = ({ current, previous, view }) => {
	const { t } = useTranslation("usage");
	const { palette, range, buckets } = view;
	const newLabel = t("change.new");

	const summary = React.useMemo(() => {
		const spend = sumSlices(current, spendOf);
		const previousSpend = sumSlices(previous, spendOf);
		const tokens = sumSlices(current, tokensOf);
		const previousTokens = sumSlices(previous, tokensOf);
		const remote = (slices: readonly UsageSlice[]) =>
			slices.filter((slice) => !slice.request.local);
		const priced = (slices: readonly UsageSlice[]) =>
			remote(slices).filter((slice) => slice.request.cost !== undefined);
		const local = current.filter((slice) => slice.request.local);
		const previousLocal = previous.filter((slice) => slice.request.local);
		const cached = sumSlices(
			remote(current),
			(slice) => slice.request.cachedTokens * slice.factor,
		);
		const remoteInput = sumSlices(
			remote(current),
			(slice) => slice.request.inputTokens * slice.factor,
		);
		const previousCached = sumSlices(
			remote(previous),
			(slice) => slice.request.cachedTokens * slice.factor,
		);
		const previousRemoteInput = sumSlices(
			remote(previous),
			(slice) => slice.request.inputTokens * slice.factor,
		);
		return {
			spend,
			previousSpend,
			tokens,
			previousTokens,
			input: sumSlices(
				current,
				(slice) => slice.request.inputTokens * slice.factor,
			),
			output: sumSlices(
				current,
				(slice) => slice.request.outputTokens * slice.factor,
			),
			conversations: conversationsOf(current),
			previousConversations: conversationsOf(previous),
			pricedTokens: sumSlices(priced(current), tokensOf),
			previousPricedTokens: sumSlices(priced(previous), tokensOf),
			unpriced: remote(current).length - priced(current).length,
			unpricedTokens: sumSlices(
				remote(current).filter((slice) => slice.request.cost === undefined),
				tokensOf,
			),
			cacheRatio: remoteInput > 0 ? cached / remoteInput : 0,
			previousCacheRatio:
				previousRemoteInput > 0 ? previousCached / previousRemoteInput : 0,
			localShare: current.length ? local.length / current.length : 0,
			previousLocalShare: previous.length
				? previousLocal.length / previous.length
				: 0,
			localTokens: sumSlices(local, tokensOf),
			byProvider: totalsBy(current, providerGroupOf, "cost"),
			providerCoverage: costCoverageBy(
				current,
				requestWeights(providerGroupOf),
			),
			tokensByProvider: totalsBy(current, providerGroupOf, "tokens"),
		};
	}, [current, previous]);

	const providers = [...summary.tokensByProvider.keys()].sort(
		(a, b) =>
			(summary.byProvider.get(b) ?? 0) - (summary.byProvider.get(a) ?? 0) ||
			(summary.tokensByProvider.get(b) ?? 0) -
				(summary.tokensByProvider.get(a) ?? 0),
	);
	const perConversation = (spend: number, conversations: number) =>
		conversations ? spend / conversations : 0;
	const perMillion = (spend: number, tokens: number) =>
		tokens ? (spend / tokens) * 1e6 : 0;

	return (
		<div className="grid gap-3 @3xl/usage:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
			<div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border/60 bg-background p-4 shadow-sm">
				<div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
					{t("summary.totalSpend")}
				</div>
				<div className="text-5xl font-semibold leading-none tracking-tight">
					{formatUsd(summary.spend)}
				</div>
				<div className="flex flex-wrap items-baseline gap-1.5 text-xs">
					<ChangeText
						current={summary.spend}
						previous={summary.previousSpend}
						polarity={-1}
						palette={palette}
						newLabel={newLabel}
						className="text-xs"
					/>
					<span className="text-muted-foreground">
						{view.compareLabel} ({formatUsd(summary.previousSpend)})
					</span>
				</div>
				<div className="text-xs text-muted-foreground">
					{t("summary.perDay", {
						value: formatUsd(summary.spend / range.days),
						requests: formatCount(current.length),
					})}
				</div>
				{summary.unpriced > 0 ? (
					<div className="text-xs text-muted-foreground">
						{t("summary.unpricedTokens", {
							count: summary.unpriced,
							tokens: formatTokens(summary.unpricedTokens),
						})}
					</div>
				) : null}
				{providers.length ? (
					<div className="mt-auto flex flex-col gap-0.5 border-t border-border/60 pt-2.5">
						{providers.map((group) => {
							const cost = summary.byProvider.get(group) ?? 0;
							const share = summary.spend > 0 ? cost / summary.spend : 0;
							const selected = view.filters.provider === group;
							const coverage = summary.providerCoverage.get(group);
							return (
								<button
									key={group}
									type="button"
									aria-pressed={selected}
									onClick={() => view.toggleFilter("provider", group)}
									className={cn(
										"-mx-1.5 grid grid-cols-[88px_minmax(0,1fr)_72px] items-center gap-2.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/60",
										selected && "bg-blue-500/10",
									)}
								>
									<span className="truncate">{view.providerLabel(group)}</span>
									<span className="h-1 overflow-hidden rounded-full bg-muted-foreground/15">
										<span
											className="block h-full rounded-full bg-foreground/35"
											style={{
												width: `${coverage?.priced ? share * 100 : 0}%`,
											}}
										/>
									</span>
									<span className="text-right tabular-nums">
										<MetricCell
											value={cost}
											coverage={coverage}
											view={{ ...view, metric: "cost", format: formatUsd }}
										/>
									</span>
								</button>
							);
						})}
					</div>
				) : null}
			</div>
			<div className="grid grid-cols-2 gap-3 @xl/usage:grid-cols-3">
				<Tile
					view={view}
					label={t("tiles.tokens")}
					value={formatTokens(summary.tokens)}
					change={
						<ChangeText
							current={summary.tokens}
							previous={summary.previousTokens}
							polarity={0}
							palette={palette}
							newLabel={newLabel}
						/>
					}
					sub={t("tiles.tokensSub", {
						input: formatTokens(summary.input),
						output: formatTokens(summary.output),
					})}
					spark={totalSeries(current, tokensOf, buckets)}
				/>
				<Tile
					view={view}
					label={t("tiles.requests")}
					value={formatCount(current.length)}
					change={
						<ChangeText
							current={current.length}
							previous={previous.length}
							polarity={0}
							palette={palette}
							newLabel={newLabel}
						/>
					}
					sub={t("tiles.conversations", { count: summary.conversations })}
					spark={totalSeries(current, () => 1, buckets)}
				/>
				<Tile
					view={view}
					label={t("tiles.perConversation")}
					value={
						summary.conversations
							? formatUsdPrecise(
									perConversation(summary.spend, summary.conversations),
								)
							: "—"
					}
					change={
						<ChangeText
							current={perConversation(summary.spend, summary.conversations)}
							previous={perConversation(
								summary.previousSpend,
								summary.previousConversations,
							)}
							polarity={-1}
							palette={palette}
							newLabel={newLabel}
						/>
					}
					sub={t("tiles.perConversationSub")}
				/>
				<Tile
					view={view}
					label={t("tiles.blendedRate")}
					value={
						summary.pricedTokens
							? formatUsdPrecise(
									perMillion(summary.spend, summary.pricedTokens),
								)
							: "—"
					}
					change={
						<ChangeText
							current={perMillion(summary.spend, summary.pricedTokens)}
							previous={perMillion(
								summary.previousSpend,
								summary.previousPricedTokens,
							)}
							polarity={-1}
							palette={palette}
							newLabel={newLabel}
						/>
					}
					sub={t("tiles.blendedRateSub")}
				/>
				<Tile
					view={view}
					label={t("tiles.cached")}
					value={formatPercent(summary.cacheRatio)}
					change={
						<ChangeText
							current={summary.cacheRatio}
							previous={summary.previousCacheRatio}
							polarity={1}
							palette={palette}
							newLabel={newLabel}
						/>
					}
					sub={t("tiles.cachedSub")}
				/>
				<Tile
					view={view}
					label={t("tiles.local")}
					value={formatPercent(summary.localShare)}
					change={
						<ChangeText
							current={summary.localShare}
							previous={summary.previousLocalShare}
							polarity={1}
							palette={palette}
							newLabel={newLabel}
						/>
					}
					sub={t("tiles.localSub", {
						tokens: formatTokens(summary.localTokens),
					})}
				/>
			</div>
		</div>
	);
};
