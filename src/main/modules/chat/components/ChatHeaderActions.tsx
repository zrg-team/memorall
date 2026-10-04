import { Bot, Loader2, Monitor, SquarePen } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import type { CoAgentToggle } from "@/main/stores/co-agent-activation";
import type { ConversationCost } from "../utils/conversation-cost-format";
import { ConversationCostBadge } from "./ConversationCostBadge";

/** Same box as the chat list button at the other end of the header. */
const HEADER_BUTTON =
	"relative h-8 w-8 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * The chat's actions in the workspace header, at its end: what the chat has
 * cost so far, the co-agent (where a page can be driven), the agent's
 * computer (for agents that have one) and a new chat, where every chat app
 * keeps it, so none of them needs the composer or the chat list.
 */
export const ChatHeaderActions: React.FC<{
	/** What the open chat has cost so far, when known. */
	cost?: ConversationCost;
	onNewChat: () => void;
	/** Opens the agent's MemonOS computer; only for agents that have one. */
	onOpenComputer?: () => void;
	/** The agent is acting on its computer right now. */
	isComputerWorking?: boolean;
	/** Lets the agent see and act on the page; absent where there is none. */
	coAgent?: CoAgentToggle;
}> = ({
	cost,
	onNewChat,
	onOpenComputer,
	isComputerWorking = false,
	coAgent,
}) => {
	const { t } = useTranslation("chat");
	const computerLabel = isComputerWorking
		? t("header.computerWorking")
		: t("tooltips.openComputer");
	const coAgentLabel = coAgent?.active
		? t("tooltips.stopCoAgent", "Turn the co-agent off")
		: t("tooltips.startCoAgent", "Let the agent see and act on the page");
	return (
		<div
			className="flex shrink-0 items-center gap-0.5"
			data-chat-header-actions
		>
			<ConversationCostBadge cost={cost} variant="header" />
			{coAgent ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={cn(
						HEADER_BUTTON,
						// Armed is a real mode — the model gets tools that can click
						// and type — so it has to be visible at a glance.
						coAgent.active &&
							"bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 hover:text-emerald-500",
					)}
					aria-label={coAgentLabel}
					aria-pressed={coAgent.active}
					title={coAgentLabel}
					disabled={coAgent.starting}
					onClick={coAgent.toggle}
					data-header-co-agent
				>
					{coAgent.starting ? (
						<Loader2 size={16} className="animate-spin" />
					) : (
						<Bot size={16} />
					)}
				</Button>
			) : null}
			{onOpenComputer ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={HEADER_BUTTON}
					aria-label={computerLabel}
					title={computerLabel}
					onClick={onOpenComputer}
				>
					<Monitor size={16} />
					{isComputerWorking ? (
						<span
							aria-hidden="true"
							className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500"
						/>
					) : null}
				</Button>
			) : null}
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className={HEADER_BUTTON}
				aria-label={t("header.newChat")}
				title={t("header.newChat")}
				data-header-new-chat
				onClick={onNewChat}
			>
				<SquarePen size={16} />
			</Button>
		</div>
	);
};
