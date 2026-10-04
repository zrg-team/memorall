import { Coins } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { badgeVariants } from "@/main/components/ui/badge";
import {
	type ConversationCost,
	cachedPercent,
	formatTokenCount,
	formatUsd,
} from "../utils/conversation-cost-format";

/** The chat's cost in full, for the badge's hover: price, tokens, requests. */
export const useConversationCostSummary = () => {
	const { t } = useTranslation("chat");
	return (cost: ConversationCost): string =>
		[
			cost.cost !== undefined
				? t("cost.total", {
						cost: formatUsd(cost.cost),
						defaultValue: "This chat so far: {{cost}}",
					})
				: t(
						"cost.noPrice",
						"This chat so far (the provider reported no price)",
					),
			t("cost.tokens", {
				input: formatTokenCount(cost.inputTokens),
				cached: cachedPercent(cost),
				output: formatTokenCount(cost.outputTokens),
				defaultValue:
					"Input {{input}} tokens ({{cached}}% from cache) · output {{output}}",
			}),
			t("cost.requests", {
				requests: cost.requests,
				replies: cost.replies,
				defaultValue: "{{requests}} model requests over {{replies}} replies",
			}),
		].join("\n");
};

/** Priced chats in green, like money; a bare token count stays quiet. */
const PRICED =
	"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
const UNPRICED = "border-border/60 bg-muted/40 text-muted-foreground";

/**
 * What a chat has cost so far. In the chat list it is a small badge beside
 * the preview; in the header it takes the look of the icon buttons it sits
 * with — same height, icon size and muted colour — rather than a pill of its
 * own. Hovering either gives the tokens behind it. A chat whose provider
 * reported no price shows its tokens instead.
 */
export const ConversationCostBadge: React.FC<{
	cost: ConversationCost | undefined;
	variant: "list" | "header";
	className?: string;
}> = ({ cost, variant, className }) => {
	const { t } = useTranslation("chat");
	const summary = useConversationCostSummary();
	if (!cost) return null;
	const priced = cost.cost !== undefined;
	const label = priced
		? formatUsd(cost.cost ?? 0)
		: t("cost.tokensOnly", {
				tokens: formatTokenCount(cost.inputTokens + cost.outputTokens),
				defaultValue: "{{tokens}} tokens",
			});
	if (variant === "header") {
		return (
			<span
				role="status"
				title={summary(cost)}
				aria-label={`${t("cost.label", "Cost of this chat")}: ${label}`}
				data-testid="chat-cost"
				className={cn(
					"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium tabular-nums text-muted-foreground",
					className,
				)}
			>
				<Coins size={16} className="shrink-0" />
				{label}
			</span>
		);
	}
	return (
		// The badge's look on a span: in the chat list it sits inside a button.
		<span
			title={summary(cost)}
			data-testid="conversation-cost"
			className={cn(
				badgeVariants({ variant: "outline" }),
				"h-5 shrink-0 gap-1 px-1.5 text-[10px] font-medium tabular-nums",
				priced ? PRICED : UNPRICED,
				className,
			)}
		>
			<Coins size={10} className="shrink-0" />
			{label}
		</span>
	);
};
