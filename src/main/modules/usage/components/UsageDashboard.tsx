import { Coins, Download, RefreshCw } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { PageHeader } from "@/main/components/ui/page-header";
import { useChatStore } from "@/main/stores/chat";
import {
	isKnownProvider,
	PROVIDER_REGISTRY,
} from "@/services/llm/provider-registry";
import { useUsageBudget } from "../hooks/use-usage-budget";
import { useUsageRequests } from "../hooks/use-usage-requests";
import { loadFeatureLabels } from "../services/usage-repository";
import type {
	UsageFilterKey,
	UsageFilters,
	UsageMetric,
	UsageRangeKey,
	UsageRequest,
	UsageSlice,
} from "../types";
import {
	EMPTY_FILTERS,
	LOCAL_PROVIDER_GROUP,
	providerGroupOf,
	requestTokens,
	resolveBuckets,
	resolveRange,
	sliceRequests,
} from "../utils/usage-aggregate";
import {
	BASE_FEATURE,
	OTHER_FEATURE,
	sourceOfFeatureKey,
} from "../utils/usage-features";
import {
	formatAxisValue,
	formatLongDate,
	formatMetric,
	formatShortDate,
	toDateLocale,
} from "../utils/usage-format";
import { findInsights } from "../utils/usage-insights";
import { BreakdownCard, type BreakdownDimension } from "./BreakdownCard";
import { BudgetMeter } from "./BudgetMeter";
import { useElementWidth } from "./chart-primitives";
import { ConversationTableCard } from "./ConversationTableCard";
import { FeatureCard } from "./FeatureCard";
import { HeatmapCard } from "./HeatmapCard";
import { InsightsRow } from "./InsightsRow";
import { SummaryCards } from "./SummaryCards";
import { TokenMixCard } from "./TokenMixCard";
import { ToolTableCard } from "./ToolTableCard";
import { TrendCard } from "./TrendCard";
import { UsageFilterBar } from "./UsageFilterBar";
import { assignSeriesColors, useUsagePalette } from "./usage-palette";
import type { UsageViewContext } from "./usage-view";

const csvCell = (value: string | number) => {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadCsv = (slices: readonly UsageSlice[], name: string) => {
	const header = [
		"time",
		"conversation",
		"agent",
		"model",
		"provider",
		"input_tokens",
		"cached_tokens",
		"output_tokens",
		"reasoning_tokens",
		"cost_usd",
		"tools",
	];
	const lines = slices.map(({ request, factor }) =>
		[
			new Date(request.at).toISOString(),
			request.conversationTitle,
			request.agent,
			request.model,
			request.provider,
			Math.round(request.inputTokens * factor),
			Math.round(request.cachedTokens * factor),
			Math.round(request.outputTokens * factor),
			Math.round(request.reasoningTokens * factor),
			request.cost === undefined ? "" : (request.cost * factor).toFixed(6),
			[...new Set(request.tools.map((share) => share.tool))].join(" "),
		]
			.map(csvCell)
			.join(","),
	);
	const blob = new Blob([[header.join(","), ...lines].join("\n")], {
		type: "text/csv",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Ranks by spend, then tokens, over everything loaded — the order series colors
 * are handed out in, so a filter never repaints what is left.
 */
const rankBy = (
	requests: readonly UsageRequest[],
	keyOf: (request: UsageRequest) => string,
) => {
	const totals = new Map<string, { cost: number; tokens: number }>();
	for (const request of requests) {
		const key = keyOf(request);
		const entry = totals.get(key) ?? { cost: 0, tokens: 0 };
		entry.cost += request.cost ?? 0;
		entry.tokens += requestTokens(request);
		totals.set(key, entry);
	}
	return [...totals.entries()]
		.sort((a, b) => b[1].cost - a[1].cost || b[1].tokens - a[1].tokens)
		.map(([key]) => key);
};

export const UsageDashboard: React.FC = () => {
	const { t, i18n } = useTranslation("usage");
	const locale = toDateLocale(i18n.language);
	const palette = useUsagePalette();
	const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
	const [rangeKey, setRangeKey] = React.useState<UsageRangeKey>("30d");
	const [metric, setMetric] = React.useState<UsageMetric>("cost");
	const [filters, setFilters] = React.useState<UsageFilters>(EMPTY_FILTERS);
	const [refreshKey, setRefreshKey] = React.useState(0);

	// Today is re-read on refresh, so a page left open past midnight catches up.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-reads the clock
	const now = React.useMemo(() => new Date(), [refreshKey]);
	const range = React.useMemo(
		() => resolveRange(rangeKey, now),
		[rangeKey, now],
	);
	const buckets = React.useMemo(() => resolveBuckets(range), [range]);
	const { requests, loading, error, reload } = useUsageRequests(
		range.previousStart,
	);
	const { budget, spend, setBudget } = useUsageBudget(refreshKey);
	const featureLabels = React.useMemo(() => loadFeatureLabels(), []);

	const current = React.useMemo(
		() => sliceRequests(requests, filters, range.start, range.end),
		[requests, filters, range],
	);
	const previous = React.useMemo(
		() =>
			sliceRequests(requests, filters, range.previousStart, range.previousEnd),
		[requests, filters, range],
	);
	const insights = React.useMemo(
		() => findInsights(current, previous, range, metric, filters),
		[current, previous, range, metric, filters],
	);

	const agents = React.useMemo(
		() => rankBy(requests, (r) => r.agent),
		[requests],
	);
	const models = React.useMemo(
		() => rankBy(requests, (r) => r.model),
		[requests],
	);
	const providers = React.useMemo(
		() => [...new Set(requests.map(providerGroupOf))].sort(),
		[requests],
	);
	const agentColors = React.useMemo(
		() => assignSeriesColors(agents, palette),
		[agents, palette],
	);
	const modelColors = React.useMemo(
		() => assignSeriesColors(models, palette),
		[models, palette],
	);
	const modelProviders = React.useMemo(() => {
		const map = new Map<string, UsageRequest>();
		for (const request of requests) {
			if (!map.has(request.model)) map.set(request.model, request);
		}
		return map;
	}, [requests]);

	const providerLabel = React.useCallback(
		(group: string) => {
			if (group === LOCAL_PROVIDER_GROUP) return t("providers.local");
			if (!group) return t("providers.unknown");
			return isKnownProvider(group)
				? t(`llm:providers.${group}`, {
						defaultValue: PROVIDER_REGISTRY[group].label,
					})
				: group;
		},
		[t],
	);
	const agentLabel = React.useCallback(
		(agent: string) => agent || t("agents.default"),
		[t],
	);
	const modelLabel = React.useCallback(
		(model: string) => {
			const request = modelProviders.get(model);
			const name = model.split("/").pop() || model || t("models.unknown");
			if (!request) return { name, sub: "" };
			const provider = isKnownProvider(request.provider)
				? PROVIDER_REGISTRY[request.provider].label
				: request.provider || t("providers.unknown");
			return {
				name,
				sub: request.local ? t("models.onDevice", { provider }) : provider,
			};
		},
		[modelProviders, t],
	);
	const featureLabel = React.useCallback(
		(feature: string) => {
			if (feature === BASE_FEATURE) return t("features.base");
			if (feature === OTHER_FEATURE) return t("features.other");
			const source = sourceOfFeatureKey(feature);
			if (source) return source.toUpperCase();
			return featureLabels.get(feature) ?? feature;
		},
		[featureLabels, t],
	);

	const toggleFilter = React.useCallback(
		(key: UsageFilterKey, value: string) =>
			setFilters((previousFilters) => ({
				...previousFilters,
				[key]: previousFilters[key] === value ? null : value,
			})),
		[],
	);

	const compareLabel =
		range.key === "mtd"
			? t("compare.monthToDate", {
					month: new Date(range.previousStart).toLocaleDateString(locale, {
						month: "short",
					}),
					day: range.days,
				})
			: t("compare.previousDays", { count: range.days });

	const view: UsageViewContext = {
		metric,
		range,
		buckets,
		locale,
		palette,
		filters,
		toggleFilter,
		format: (value) => formatMetric(value, metric),
		formatAxis: (value, step) => formatAxisValue(value, step, metric),
		bucketLabel: (index) =>
			formatShortDate(buckets.edges[index] ?? range.start, locale),
		bucketTitle: (index) => {
			const from = buckets.edges[index] ?? range.start;
			if (buckets.unit === "day") return formatLongDate(from, locale);
			const to = (buckets.edges[index + 1] ?? range.end) - 1;
			return `${formatShortDate(from, locale)} – ${formatShortDate(to, locale)}`;
		},
		agentLabel,
		modelLabel,
		featureLabel,
		providerLabel,
		agentColors,
		modelColors,
		compareLabel,
	};

	const agentDimension: BreakdownDimension = {
		filterKey: "agent",
		keyOf: (request) => request.agent,
		colors: agentColors,
		label: (key) => ({
			name: agentLabel(key),
			sub: key ? "" : t("agents.defaultSub"),
		}),
		title: t("breakdown.agent"),
		column: t("breakdown.agentColumn"),
	};
	const modelDimension: BreakdownDimension = {
		filterKey: "model",
		keyOf: (request) => request.model,
		colors: modelColors,
		label: modelLabel,
		mono: true,
		title: t("breakdown.model"),
		column: t("breakdown.modelColumn"),
	};

	const refresh = () => {
		setRefreshKey((value) => value + 1);
		reload();
	};
	const hasAnyUsage = requests.length > 0;
	const wide = rootWidth >= 760;

	return (
		<div
			ref={rootRef}
			className="@container/usage flex h-full min-h-0 flex-col bg-background"
		>
			<PageHeader
				icon={<Coins size={18} />}
				title={t("title")}
				description={t("description")}
				actionsPlacement={wide ? "inline" : "bottom"}
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<BudgetMeter
							budget={budget}
							spend={spend}
							onBudgetChange={setBudget}
							palette={palette}
							locale={locale}
						/>
						<Button
							size="icon"
							variant="outline"
							className="h-8 w-8"
							onClick={refresh}
							disabled={loading}
							aria-label={t("actions.refresh")}
							title={t("actions.refresh")}
						>
							<RefreshCw size={14} className={cn(loading && "animate-spin")} />
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="h-8 gap-1.5 text-xs"
							disabled={!current.length}
							onClick={() =>
								downloadCsv(current, `memorall-usage-${range.key}.csv`)
							}
						>
							<Download size={14} />
							{t("actions.exportCsv")}
						</Button>
					</div>
				}
			/>
			<UsageFilterBar
				range={rangeKey}
				onRangeChange={setRangeKey}
				metric={metric}
				onMetricChange={setMetric}
				filters={filters}
				onFilterChange={(key, value) =>
					setFilters((previousFilters) => ({
						...previousFilters,
						[key]: value,
					}))
				}
				onReset={() => setFilters(EMPTY_FILTERS)}
				agents={agents}
				providers={providers}
				agentLabel={agentLabel}
				providerLabel={providerLabel}
				chipLabel={(key, value) =>
					key === "model"
						? modelLabel(value).name
						: key === "feature"
							? featureLabel(value)
							: value
				}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{error ? (
					<div className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
						<span>{t("error.load", { message: error })}</span>
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							onClick={refresh}
						>
							{t("actions.retry")}
						</Button>
					</div>
				) : null}
				{!hasAnyUsage ? (
					<div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-16 text-center">
						<Coins size={28} className="text-muted-foreground" />
						<h2 className="text-base font-semibold">
							{loading ? t("empty.loading") : t("empty.title")}
						</h2>
						{loading ? null : (
							<p className="text-sm text-muted-foreground">
								{t("empty.description")}
							</p>
						)}
					</div>
				) : (
					<div
						className={cn(
							"flex flex-col gap-4 p-4 transition-opacity",
							loading && "opacity-60",
						)}
					>
						<SummaryCards current={current} previous={previous} view={view} />
						<InsightsRow insights={insights} view={view} />
						<TrendCard current={current} previous={previous} view={view} />
						<div className="grid items-start gap-4 @4xl/usage:grid-cols-2">
							<BreakdownCard
								current={current}
								previous={previous}
								dimension={agentDimension}
								view={view}
							/>
							<BreakdownCard
								current={current}
								previous={previous}
								dimension={modelDimension}
								view={view}
							/>
						</div>
						<div className="grid items-start gap-4 @4xl/usage:grid-cols-2">
							<FeatureCard current={current} previous={previous} view={view} />
							<div className="flex min-w-0 flex-col gap-4">
								<TokenMixCard current={current} view={view} />
								<HeatmapCard current={current} view={view} />
							</div>
						</div>
						<ToolTableCard current={current} previous={previous} view={view} />
						<ConversationTableCard
							current={current}
							view={view}
							onOpen={(id) => void useChatStore.getState().loadConversation(id)}
						/>
						<details className="px-1 pb-6 text-xs text-muted-foreground">
							<summary className="cursor-pointer font-medium text-foreground/80">
								{t("method.title")}
							</summary>
							<ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">
								<li>{t("method.cost")}</li>
								<li>{t("method.tools")}</li>
								<li>{t("method.features")}</li>
								<li>{t("method.local")}</li>
								<li>{t("method.notCounted")}</li>
							</ul>
						</details>
					</div>
				)}
			</div>
		</div>
	);
};
