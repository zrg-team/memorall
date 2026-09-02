import dayjs from "dayjs";
import {
	Box,
	Check,
	ChevronDown,
	ChevronUp,
	Clock,
	Copy,
	FolderOpen,
	Gauge,
	Hash,
	Sparkles,
	Zap,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Message as DBMessage } from "@/services/database/types";
import {
	type AggregatedTokenUsage,
	getCacheHitRatio,
	type TokenUsage,
} from "@/services/llm/utils/token-usage";
import { logError } from "@/utils/logger";
import { DocumentSaveFolderDialog } from "./DocumentSaveFolderDialog";

export interface MessageFooterMetadata extends Record<string, unknown> {
	model?: string;
	provider?: string;
	timeToAnswer?: number;
	tokensPerSecond?: number;
	estimatedTokens?: number;
	/**
	 * Provider-reported usage for the turn. Messages saved before per-request
	 * accounting existed carry only the three totals, hence the partial.
	 */
	usage?: TokenUsage &
		Partial<Pick<AggregatedTokenUsage, "requests" | "calls">>;
}

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

const cacheChipClass = (percent?: number): string => {
	if (percent === undefined) {
		return "bg-muted/50 border-border/40 text-muted-foreground";
	}
	if (percent >= 50) {
		return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
	}
	if (percent > 0) {
		return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
	}
	return "bg-muted/50 border-border/40 text-muted-foreground";
};

interface MessageFooterProps {
	message: DBMessage;
	groupMessages: DBMessage[];
	selectedTopic?: string;
	metadata: MessageFooterMetadata;
}

export const MessageFooter: React.FC<MessageFooterProps> = React.memo(
	({ message, groupMessages, metadata }) => {
		const { t } = useTranslation("chat");
		const [copied, setCopied] = useState(false);
		const [saved, setSaved] = useState(false);
		const [saveDialogOpen, setSaveDialogOpen] = useState(false);
		const [showFullInfo, setShowFullInfo] = useState(false);

		const {
			model,
			provider,
			timeToAnswer,
			tokensPerSecond,
			estimatedTokens,
			usage,
		} = metadata;

		const cacheHitRatio = getCacheHitRatio(usage);
		const cacheHitPercent =
			cacheHitRatio === undefined ? undefined : Math.round(cacheHitRatio * 100);
		const requestCount = usage?.requests ?? (usage ? 1 : 0);
		const calls = usage?.calls ?? [];

		const usageRows = usage
			? [
					{
						key: "input",
						label: t("messages.inputTokens", "Input"),
						value: formatTokens(usage.prompt_tokens),
					},
					{
						key: "cached",
						label: t("messages.cachedTokens", "Cached"),
						value:
							usage.cached_tokens === undefined
								? "-"
								: `${formatTokens(usage.cached_tokens)} (${cacheHitPercent ?? 0}%)`,
					},
					...(usage.cache_write_tokens !== undefined
						? [
								{
									key: "cacheWrite",
									label: t("messages.cacheWriteTokens", "Cache write"),
									value: formatTokens(usage.cache_write_tokens),
								},
							]
						: []),
					{
						key: "output",
						label: t("messages.outputTokens", "Output"),
						value: formatTokens(usage.completion_tokens),
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
					...(usage.cost !== undefined
						? [
								{
									key: "cost",
									label: t("messages.cost", "Cost"),
									value: formatCost(usage.cost),
								},
							]
						: []),
				]
			: [];

		const formatTime = (seconds?: number) => {
			if (!seconds) return "-";
			if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
			return `${seconds.toFixed(2)}s`;
		};

		const formatTokensPerSecond = (tps?: number) => {
			if (!tps) return "-";
			return `${tps.toFixed(1)} t/s`;
		};

		const getProviderBadgeColor = () => {
			return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
		};

		const getModelBadgeColor = () => {
			return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
		};

		const getProviderLabel = (providerName?: string) => {
			return providerName || "Unknown";
		};

		const handleCopy = useCallback(async () => {
			try {
				await navigator.clipboard.writeText(message.content);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch (error) {
				logError("Failed to copy message:", error);
			}
		}, [message.content]);

		const documentContent = useMemo(() => {
			const conversationText = groupMessages
				.filter((msg) => msg.type !== "separator" && msg.content)
				.map((msg) => {
					const role = msg.role === "user" ? "User" : "Assistant";
					return `${role}: ${msg.content}`;
				})
				.join("\n\n");

			const sourceInfo = `Conversation from chat\nDate: ${dayjs().format("MMM D, YYYY h:mm A")}\n\n`;
			return sourceInfo + conversationText;
		}, [groupMessages]);

		const documentFileName = useMemo(
			() => `chat-conversation-${dayjs().format("YYYY-MM-DD-HHmmss")}.md`,
			[],
		);

		const handleSaveToRemembered = useCallback(() => {
			setSaveDialogOpen(true);
		}, []);

		return (
			<div className="mt-3 border-t border-border/40 pt-2">
				<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={handleCopy}
							className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							title={
								copied
									? t("messages.copied", "Copied!")
									: t("messages.copy", "Copy message")
							}
						>
							{copied ? (
								<Check className="h-3.5 w-3.5 text-green-500" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)}
							<span>
								{copied
									? t("messages.copied", "Copied")
									: t("messages.copy", "Copy")}
							</span>
						</button>

						<button
							type="button"
							onClick={handleSaveToRemembered}
							className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							title={
								saved
									? t("messages.saved", "Saved!")
									: t("messages.saveToDocuments", "Save to documents")
							}
						>
							{saved ? (
								<Check className="h-3.5 w-3.5 text-green-500" />
							) : (
								<FolderOpen className="h-3.5 w-3.5" />
							)}
							<span>
								{saved
									? t("messages.saved", "Saved")
									: t("messages.save", "Save")}
							</span>
						</button>
					</div>

					<div className="flex items-center">
						<button
							type="button"
							onClick={() => setShowFullInfo(!showFullInfo)}
							className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-expanded={showFullInfo}
						>
							<span>{t("messages.responseDetails", "Response details")}</span>
							{showFullInfo ? (
								<ChevronUp className="h-3.5 w-3.5" />
							) : (
								<ChevronDown className="h-3.5 w-3.5" />
							)}
						</button>
					</div>
				</div>

				<div
					className={`overflow-hidden transition-all duration-200 ease-in-out ${
						showFullInfo
							? "max-h-[40rem] opacity-100 mt-2"
							: "max-h-0 opacity-0"
					}`}
				>
					<div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-2 text-xs">
						{provider && (
							<div
								className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${getProviderBadgeColor()}`}
							>
								<Sparkles className="h-3 w-3" />
								<span>{getProviderLabel(provider)}</span>
							</div>
						)}

						{model && (
							<div
								className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium ${getModelBadgeColor()}`}
							>
								<Box className="w-3 h-3" />
								<span>{model}</span>
							</div>
						)}

						{timeToAnswer !== undefined && (
							<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-muted-foreground">
								<Clock className="w-3 h-3" />
								<span>{formatTime(timeToAnswer)}</span>
							</div>
						)}

						{tokensPerSecond !== undefined && (
							<div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 text-muted-foreground">
								<Gauge className="h-3 w-3" />
								<span>{formatTokensPerSecond(tokensPerSecond)}</span>
							</div>
						)}

						{estimatedTokens !== undefined && (
							<div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-muted-foreground">
								<Hash className="w-3 h-3" />
								<span>
									{usage?.estimated ? "~" : ""}
									{estimatedTokens.toLocaleString()} tokens
								</span>
							</div>
						)}

						{usage && (
							<div
								className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${cacheChipClass(cacheHitPercent)}`}
								title={
									cacheHitPercent === undefined
										? t(
												"messages.noCacheInfo",
												"The provider reported no prompt-cache data",
											)
										: `${formatTokens(usage.cached_tokens)} / ${formatTokens(usage.prompt_tokens)} ${t("messages.inputTokens", "Input").toLowerCase()}`
								}
								data-testid="message-cache-chip"
							>
								<Zap className="h-3 w-3" />
								<span>
									{t("messages.cacheHit", "Cache hit")}{" "}
									{cacheHitPercent === undefined ? "-" : `${cacheHitPercent}%`}
								</span>
							</div>
						)}
					</div>

					{usage && (
						<div
							className="mt-2 rounded-md border border-border/40 bg-muted/30 p-2 text-xs"
							data-testid="message-usage-details"
						>
							<div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
								<span>{t("messages.tokenDetails", "Token usage")}</span>
								{usage.estimated ? (
									<span className="font-normal">
										{t(
											"messages.estimatedUsage",
											"Estimated locally, the provider sent no usage",
										)}
									</span>
								) : cacheHitPercent === undefined ? (
									<span className="font-normal">
										{t(
											"messages.noCacheInfo",
											"The provider reported no prompt-cache data",
										)}
									</span>
								) : null}
							</div>
							<dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
								{usageRows.map((row) => (
									<div key={row.key} className="flex justify-between gap-2">
										<dt className="text-muted-foreground">{row.label}</dt>
										<dd className="tabular-nums">{row.value}</dd>
									</div>
								))}
							</dl>
							{requestCount > 1 && calls.length > 0 ? (
								<ol className="mt-2 space-y-0.5 border-t border-border/40 pt-1 text-[11px] text-muted-foreground">
									<li className="font-medium">
										{t("messages.requestBreakdown", "Per request")}
									</li>
									{calls.map((call, index) => (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: requests carry no id and the list is append-only, so the position is the identity
											key={index}
											className="flex flex-wrap gap-x-3 tabular-nums"
										>
											<span className="w-6">#{index + 1}</span>
											<span>
												{t("messages.inputTokens", "Input")}{" "}
												{formatTokens(call.prompt_tokens)}
											</span>
											<span>
												{t("messages.cachedTokens", "Cached")}{" "}
												{call.cached_tokens === undefined
													? "-"
													: `${formatTokens(call.cached_tokens)} (${percentOf(call.cached_tokens, call.prompt_tokens) ?? 0}%)`}
											</span>
											{call.cache_write_tokens ? (
												<span>
													{t("messages.cacheWriteTokens", "Cache write")}{" "}
													{formatTokens(call.cache_write_tokens)}
												</span>
											) : null}
											<span>
												{t("messages.outputTokens", "Output")}{" "}
												{formatTokens(call.completion_tokens)}
											</span>
										</li>
									))}
								</ol>
							) : null}
						</div>
					)}
				</div>
				<DocumentSaveFolderDialog
					open={saveDialogOpen}
					content={documentContent}
					initialFileName={documentFileName}
					mimeType="text/markdown"
					onOpenChange={setSaveDialogOpen}
					onSaved={() => {
						setSaved(true);
						setTimeout(() => setSaved(false), 3000);
					}}
					onError={(error) => {
						logError("Failed to save chat transcript to documents:", error);
					}}
				/>
			</div>
		);
	},
);
