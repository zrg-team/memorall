import { Monitor, SquarePen } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";

/** Same box as the chat list button at the other end of the header. */
const HEADER_BUTTON =
	"relative h-8 w-8 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * The chat's actions in the workspace header, at its end: the agent's
 * computer (for agents that have one) and a new chat, where every chat app
 * keeps it, so neither needs the composer or the chat list.
 */
export const ChatHeaderActions: React.FC<{
	onNewChat: () => void;
	/** Opens the agent's MemonOS computer; only for agents that have one. */
	onOpenComputer?: () => void;
	/** The agent is acting on its computer right now. */
	isComputerWorking?: boolean;
}> = ({ onNewChat, onOpenComputer, isComputerWorking = false }) => {
	const { t } = useTranslation("chat");
	const computerLabel = isComputerWorking
		? t("header.computerWorking")
		: t("tooltips.openComputer");
	return (
		<div
			className="flex shrink-0 items-center gap-0.5"
			data-chat-header-actions
		>
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
