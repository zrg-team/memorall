import { AlertTriangle } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
	type AggregatedTokenUsage,
	type CacheContinuity,
	describeCacheContinuity,
	getCacheHitRatio,
	type TokenUsage,
} from "@/services/llm/utils/token-usage";

export type TokenUsageDetails = TokenUsage &
	Partial<Pick<AggregatedTokenUsage, "requests" | "calls">>;

const formatTokens = (value?: number): string =>
	value === undefined ? "-" : value.toLocaleString();

const percentOf = (part?: number, whole?: number): number | undefined =>
	part === undefined || !whole ? undefined : Math.round((part / whole) * 100);

const formatCost = (cost?: number): string => {
	if (cost === undefined) return "-";
	return cost > 0 && cost < 0.01
		? `$${cost.toFixed(5)}`
		: `$${cost.toFixed(4)}`;
};

/** Green once most of the prompt is reused, amber when some is, muted at none. */
const hitTone = (percent?: number): string => {
	if (percent === undefined || percent === 0) return "bg-muted-foreground/30";
	if (percent >= 50) return "bg-green-500";
	return "bg-amber-500";
};

const isMiss = (status: CacheContinuity): boolean =>
	status === "partial" || status === "restarted";

/**
 * One headline number. The label sits above the value rather than beside it:
 * side by side, a seven-digit count and its label competed for the same row
 * and ran into the neighbouring cell as soon as the chat column narrowed.
 */
const Stat: React.FC<{
	label: string;
	value: string;
	hint?: React.ReactNode;
	testId?: string;
}> = ({ label, value, hint, testId }) => (
	<div
		className="min-w-0 rounded-md border border-border/50 bg-background px-2 py-1.5"
		data-testid={testId}
	>
		<dt className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
			{label}
		</dt>
		<dd className="truncate text-sm font-semibold tabular-nums" title={value}>
			{value}
		</dd>
		{hint ? (
			<dd className="truncate text-[10px] text-muted-foreground">{hint}</dd>
		) : null}
	</div>
);

/** A thin track showing how much of a prompt was served from cache. */
const HitBar: React.FC<{
	percent?: number;
	className?: string;
	/** Force the warning tone, whatever the percentage says. */
	warn?: boolean;
}> = ({ percent, className, warn }) => (
	<span
		aria-hidden="true"
		className={cn(
			"relative h-1 overflow-hidden rounded-full bg-muted-foreground/15",
			className,
		)}
	>
		<span
			className={cn(
				"absolute inset-y-0 left-0 rounded-full",
				warn && (percent ?? 0) > 0 ? "bg-amber-500" : hitTone(percent),
			)}
			style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }}
		/>
	</span>
);

export interface TokenUsagePanelProps {
	usage: TokenUsageDetails;
}

/**
 * What a turn cost and how well it reused the provider's prompt cache.
 *
 * Laid out with container queries rather than viewport breakpoints, because it
 * lives in a chat column the user can resize: a wide window with a narrow chat
 * used to pick the four-column layout anyway and overlap every number.
 */
export const TokenUsagePanel: React.FC<TokenUsagePanelProps> = ({ usage }) => {
	const { t } = useTranslation("chat");

	const cacheHitRatio = getCacheHitRatio(usage);
	const cacheHitPercent =
		cacheHitRatio === undefined ? undefined : Math.round(cacheHitRatio * 100);
	const requestCount = usage.requests ?? 1;
	const calls = usage.calls ?? [];

	const continuity = useMemo(() => describeCacheContinuity(calls), [calls]);
	const missCount = continuity.filter(isMiss).length;
	const showCacheWrite = calls.some(
		(call) => (call.cache_write_tokens ?? 0) > 0,
	);

	const note = usage.estimated
		? t(
				"messages.estimatedUsage",
				"Estimated locally, the provider sent no usage",
			)
		: cacheHitPercent === undefined
			? t("messages.noCacheInfo", "The provider reported no prompt-cache data")
			: null;

	const secondary = [
		{
			key: "total",
			label: t("messages.totalTokens", "Total"),
			value: formatTokens(usage.total_tokens),
		},
		{
			key: "requests",
			label: t("messages.requests", "Requests"),
			value: String(requestCount),
		},
		...(usage.reasoning_tokens !== undefined
			? [
					{
						key: "reasoning",
						label: t("messages.reasoningTokens", "Reasoning"),
						value: formatTokens(usage.reasoning_tokens),
					},
				]
			: []),
		...(usage.cache_write_tokens !== undefined
			? [
					{
						key: "cacheWrite",
						label: t("messages.cacheWriteTokens", "Cache write"),
						value: formatTokens(usage.cache_write_tokens),
					},
				]
			: []),
	];

	return (
		<section
			className="@container mt-2 rounded-lg border border-border/40 bg-muted/30 p-2.5 text-xs"
			data-testid="message-usage-details"
		>
			<header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
				<h4 className="text-[11px] font-medium text-muted-foreground">
					{t("messages.tokenDetails", "Token usage")}
				</h4>
				{note ? (
					<span className="text-[11px] text-muted-foreground">{note}</span>
				) : null}
			</header>

			<dl className="grid grid-cols-2 gap-1.5 @[26rem]:grid-cols-4">
				<Stat
					label={t("messages.inputTokens", "Input")}
					value={formatTokens(usage.prompt_tokens)}
					testId="usage-input"
				/>
				<Stat
					label={t("messages.cachedTokens", "Cached")}
					value={
						usage.cached_tokens === undefined
							? "-"
							: formatTokens(usage.cached_tokens)
					}
					testId="usage-cached"
					hint={
						cacheHitPercent === undefined ? undefined : (
							<span className="flex items-center gap-1.5">
								<HitBar percent={cacheHitPercent} className="w-10 shrink-0" />
								<span className="tabular-nums">{cacheHitPercent}%</span>
							</span>
						)
					}
				/>
				<Stat
					label={t("messages.outputTokens", "Output")}
					value={formatTokens(usage.completion_tokens)}
					testId="usage-output"
				/>
				<Stat
					label={t("messages.cost", "Cost")}
					value={formatCost(usage.cost)}
					testId="usage-cost"
				/>
			</dl>

			<dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-0.5 text-[11px]">
				{secondary.map((item) => (
					<div
						key={item.key}
						className="flex min-w-0 items-baseline gap-1.5"
						data-testid={`usage-${item.key}`}
					>
						<dt className="text-muted-foreground">{item.label}</dt>
						<dd className="font-medium tabular-nums">{item.value}</dd>
					</div>
				))}
			</dl>

			{requestCount > 1 && calls.length > 0 ? (
				<div className="mt-2.5 border-t border-border/40 pt-2">
					<div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
						<h5 className="text-[11px] font-medium text-muted-foreground">
							{t("messages.requestBreakdown", "Per request")}
						</h5>
						{missCount > 0 ? (
							<span
								className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
								data-testid="usage-cache-misses"
							>
								<AlertTriangle
									className="h-3 w-3 shrink-0"
									aria-hidden="true"
								/>
								{t("messages.cacheMisses", {
									count: missCount,
									defaultValue:
										missCount === 1
											? "{{count}} request didn't reuse the previous one"
											: "{{count}} requests didn't reuse the previous one",
								})}
							</span>
						) : null}
					</div>

					{/* Scrolls sideways at the narrowest widths instead of overlapping. */}
					<div className="-mx-1 overflow-x-auto px-1">
						<table className="w-full min-w-[16rem] border-collapse tabular-nums @[40rem]:w-auto @[40rem]:min-w-[26rem]">
							<thead>
								<tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
									<th className="py-1 pr-2 text-left font-medium">#</th>
									<th className="py-1 pr-2 text-right font-medium">
										{t("messages.inputTokens", "Input")}
									</th>
									<th className="py-1 pr-2 text-right font-medium">
										{t("messages.cachedTokens", "Cached")}
									</th>
									{showCacheWrite ? (
										<th className="py-1 pr-2 text-right font-medium">
											{t("messages.cacheWriteTokens", "Cache write")}
										</th>
									) : null}
									<th className="py-1 text-right font-medium">
										{t("messages.outputTokens", "Output")}
									</th>
								</tr>
							</thead>
							<tbody className="text-[11px]">
								{calls.map((call, index) => {
									const percent = percentOf(
										call.cached_tokens,
										call.prompt_tokens,
									);
									const status = continuity[index] ?? "unknown";
									const missed = isMiss(status);
									const reason =
										status === "restarted"
											? t(
													"messages.cacheRestarted",
													"Nothing was reused from the previous request.",
												)
											: status === "partial"
												? t(
														"messages.cachePartial",
														"Reused an older request instead of the previous one — likely served by a different provider.",
													)
												: undefined;
									return (
										<tr
											// biome-ignore lint/suspicious/noArrayIndexKey: requests carry no id and the list is append-only, so the position is the identity
											key={index}
											className={cn(
												"border-t border-border/20",
												missed && "bg-amber-500/5",
											)}
											title={reason}
											data-testid={`usage-call-${index + 1}`}
											data-continuity={status}
										>
											<td className="py-1 pr-2 text-muted-foreground">
												<span className="flex items-center gap-1">
													{index + 1}
													{missed ? (
														<AlertTriangle
															className="h-3 w-3 shrink-0 text-amber-500"
															aria-label={reason}
														/>
													) : null}
												</span>
											</td>
											<td className="py-1 pr-2 text-right">
												{formatTokens(call.prompt_tokens)}
											</td>
											<td className="py-1 pr-2 text-right">
												{call.cached_tokens === undefined ? (
													"-"
												) : (
													<span className="inline-flex items-center justify-end gap-1.5">
														{/* Fixed-width tracks, so the bars stack in a straight
														    column instead of shifting with each number's width. */}
														<HitBar
															percent={percent}
															warn={missed}
															className="hidden w-8 shrink-0 @[20rem]:block"
														/>
														<span className="min-w-[4.5rem] text-right">
															{formatTokens(call.cached_tokens)}
														</span>
														<span className="w-9 text-right text-muted-foreground">
															{percent ?? 0}%
														</span>
													</span>
												)}
											</td>
											{showCacheWrite ? (
												<td className="py-1 pr-2 text-right">
													{call.cache_write_tokens
														? formatTokens(call.cache_write_tokens)
														: "-"}
												</td>
											) : null}
											<td className="py-1 text-right">
												{formatTokens(call.completion_tokens)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			) : null}
		</section>
	);
};
