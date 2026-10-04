import { ArrowUp, Clock3, Loader2, Pencil, X } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import type { QueuedChatMessage } from "@/main/stores/chat-message-queue";

export interface MessageQueueListProps {
	/** Sent once the reply finishes, oldest first. */
	queued: QueuedChatMessage[];
	/** Sent into the running reply, not read by the agent yet. */
	pending: QueuedChatMessage[];
	/** The reply was stopped or failed: the queue waits for the user. */
	paused: boolean;
	onSend: (id: string) => void;
	onEdit: (id: string) => void;
	onRemove: (id: string) => void;
}

const ROW =
	"flex min-h-8 items-center gap-2 rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1 text-xs";
const ACTION =
	"h-6 w-6 shrink-0 rounded-lg px-0 text-muted-foreground hover:text-foreground";

const attachmentCount = (message: QueuedChatMessage) =>
	message.images.length + message.documentRefs.length;

/**
 * Messages written while the chat was busy, above the composer: the ones the
 * agent will read at its next step, then the ones that go out after the reply.
 */
export const MessageQueueList: React.FC<MessageQueueListProps> = ({
	queued,
	pending,
	paused,
	onSend,
	onEdit,
	onRemove,
}) => {
	const { t } = useTranslation("chat");
	if (queued.length === 0 && pending.length === 0) return null;
	const sendLabel = t("queue.sendNow", "Send now");
	const editLabel = t("queue.edit", "Edit");
	const removeLabel = t("queue.remove", "Remove");

	return (
		<ul
			className="mb-2 flex flex-col gap-1"
			aria-label={t("queue.label", "Messages waiting to be sent")}
			data-testid="message-queue"
		>
			{pending.map((message) => (
				<li key={message.id} className={ROW} data-queue-state="pending">
					<Loader2
						size={13}
						className="shrink-0 animate-spin text-muted-foreground"
						aria-hidden="true"
					/>
					<span className="shrink-0 font-medium text-foreground/80">
						{t("queue.pending", "Next step")}
					</span>
					<span className="min-w-0 flex-1 truncate text-muted-foreground">
						{message.text}
					</span>
				</li>
			))}
			{queued.map((message, index) => {
				const attachments = attachmentCount(message);
				return (
					<li key={message.id} className={ROW} data-queue-state="queued">
						<Clock3
							size={13}
							className="shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="shrink-0 font-medium text-foreground/80">
							{paused && index === 0
								? t("queue.paused", "Waiting for you")
								: t("queue.queued", "Queued")}
						</span>
						<span
							className="min-w-0 flex-1 truncate text-muted-foreground"
							title={message.text}
						>
							{message.text}
							{attachments > 0
								? ` · ${t("queue.attachments", {
										count: attachments,
										defaultValue:
											attachments === 1
												? "{{count}} attachment"
												: "{{count}} attachments",
									})}`
								: ""}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={ACTION}
							aria-label={sendLabel}
							title={sendLabel}
							onClick={() => onSend(message.id)}
						>
							<ArrowUp size={13} />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={ACTION}
							aria-label={editLabel}
							title={editLabel}
							onClick={() => onEdit(message.id)}
						>
							<Pencil size={12} />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className={ACTION}
							aria-label={removeLabel}
							title={removeLabel}
							onClick={() => onRemove(message.id)}
						>
							<X size={13} />
						</Button>
					</li>
				);
			})}
		</ul>
	);
};
