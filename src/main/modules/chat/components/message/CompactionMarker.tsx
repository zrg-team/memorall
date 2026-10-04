import { Shrink } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import type { ChatCompaction } from "@/types/chat";

const formatTokens = (value: number): string =>
	value >= 1_000_000
		? `${(value / 1_000_000).toFixed(1)}M`
		: value >= 1_000
			? `${Math.round(value / 1_000)}k`
			: String(value);

/**
 * Where the conversation was compacted in a reply: a line between the steps
 * before it and the ones after, so it is clear from which point on the agent
 * worked with a shortened history. The saved conversation is not changed.
 */
export const CompactionMarker: React.FC<{ compaction: ChatCompaction }> = ({
	compaction,
}) => {
	const { t } = useTranslation("chat");
	const what = [
		compaction.shortened > 0
			? t("messages.compaction.shortened", {
					count: compaction.shortened,
					defaultValue:
						compaction.shortened === 1
							? "{{count}} tool result shortened"
							: "{{count}} tool results shortened",
				})
			: null,
		compaction.removed > 0
			? t("messages.compaction.removed", {
					count: compaction.removed,
					defaultValue:
						compaction.removed === 1
							? "{{count}} older message set aside"
							: "{{count}} older messages set aside",
				})
			: null,
	].filter(Boolean);
	const explanation =
		compaction.reason === "token-budget"
			? t("messages.compaction.budgetHint", {
					budget: formatTokens(compaction.windowTokens),
					defaultValue:
						"The provider refused the request as too large, so the conversation was compacted to fit {{budget}} tokens. Your saved chat is unchanged.",
				})
			: t("messages.compaction.thresholdHint", {
					window: formatTokens(compaction.windowTokens),
					defaultValue:
						"The conversation was filling the model's {{window}}-token window, so older tool results were shortened and old steps set aside before the next request. Your saved chat is unchanged.",
				});
	return (
		<div
			role="note"
			title={explanation}
			data-testid="compaction-marker"
			className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"
		>
			<span aria-hidden="true" className="h-px flex-1 bg-border" />
			<span className="flex min-w-0 max-w-[85%] items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5">
				<Shrink size={12} className="shrink-0 text-amber-500" />
				<span className="shrink-0 whitespace-nowrap font-medium text-foreground/80">
					{t("messages.compaction.title", "Context compacted")}
				</span>
				<span className="min-w-0 truncate tabular-nums">
					{t("messages.compaction.tokens", {
						before: formatTokens(compaction.beforeTokens),
						after: formatTokens(compaction.afterTokens),
						defaultValue: "{{before}} → {{after}} tokens",
					})}
					{what.length ? ` · ${what.join(", ")}` : ""}
				</span>
			</span>
			<span aria-hidden="true" className="h-px flex-1 bg-border" />
		</div>
	);
};
