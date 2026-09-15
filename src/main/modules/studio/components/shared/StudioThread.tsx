import { AlertTriangle, CircleStop } from "lucide-react";
import type React from "react";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ThreeDotsLoader } from "@/main/components/atoms/ThreeDotsLoader";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/main/components/ui/shadcn-io/ai/conversation";
import {
	Message,
	MessageContent,
} from "@/main/components/ui/shadcn-io/ai/message";
import { providerLabel, shortModelName } from "@/main/hooks/selectable-model";
import type { StudioItem } from "@/types/studio";
import { MODEL_ERROR_TEXT, describeModelError } from "../../model-load-error";

/** A run's failure in words: model errors are explained, others shown as-is. */
const FailureText: React.FC<{ error?: string }> = ({ error }) => {
	const { t } = useTranslation("studio");
	if (!error) return <>{t("common.failed", { defaultValue: "Failed" })}</>;
	const described = describeModelError(error);
	if (described.kind === "other") return <>{described.detail}</>;
	return (
		<span title={described.detail}>
			{t(`modelError.${described.kind}`, {
				modelType: described.modelType ?? "",
				defaultValue: MODEL_ERROR_TEXT[described.kind],
			})}
		</span>
	);
};

/** Chat's message time format: "9:41 AM". */
export const formatTurnTime = (date: Date) =>
	date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const formatDuration = (ms?: number) => {
	if (!ms) return null;
	return ms < 1000
		? `${ms} ms`
		: `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
};

interface StudioThreadProps {
	/** True before the first generation: the empty state fills the panel. */
	empty: boolean;
	isNarrow: boolean;
	children: React.ReactNode;
}

/**
 * A studio's scrolling history, built from chat's conversation primitives:
 * it sticks to the newest generation, offers the same jump-to-bottom button
 * and uses the same column width and spacing as a chat.
 */
export const StudioThread: React.FC<StudioThreadProps> = ({
	empty,
	isNarrow,
	children,
}) => (
	<Conversation className="min-h-0 flex-1 bg-transparent" data-studio-thread>
		<ConversationContent
			className={cn(
				// `chat-conversation-content` is chat's column padding (tighter when
				// the panel is narrow, via the container query in globals.css).
				"chat-conversation-content mx-auto flex w-full max-w-4xl flex-col",
				empty && isNarrow
					? "h-full min-h-0 space-y-3 pb-2 pt-12"
					: "min-h-full space-y-8 pb-8 pt-16",
			)}
		>
			{children}
		</ConversationContent>
		<ConversationScrollButton />
	</Conversation>
);

/** Chat's message-footer button: icon and label, quiet until hovered. */
export const STUDIO_ACTION_CLASS =
	"inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

type StudioActionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	icon: React.ReactNode;
	label: string;
	/** Icon only (the label stays as the accessible name and tooltip). */
	iconOnly?: boolean;
	destructive?: boolean;
};

export const StudioAction = forwardRef<HTMLButtonElement, StudioActionProps>(
	(
		{ icon, label, iconOnly = false, destructive = false, className, ...props },
		ref,
	) => (
		<button
			ref={ref}
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				STUDIO_ACTION_CLASS,
				destructive && "hover:text-destructive",
				className,
			)}
			{...props}
		>
			{icon}
			{iconOnly ? null : <span>{label}</span>}
		</button>
	),
);
StudioAction.displayName = "StudioAction";

interface StudioTurnProps {
	item: StudioItem;
	/** What the user asked for: the prompt, script, recording or image. */
	request: React.ReactNode;
	/** The generation's output. Omitted while nothing has arrived yet. */
	children?: React.ReactNode;
	/** Footer buttons under the output (copy, reuse, retry, delete…). */
	actions?: React.ReactNode;
	/** Extra footer facts beside the model and duration. */
	details?: React.ReactNode;
	/** Live status text while running (e.g. "42% · 12s"). */
	runningLabel?: React.ReactNode;
	className?: string;
	[data: `data-${string}`]: string | boolean | undefined;
}

/**
 * One generation laid out as a chat exchange: the request as the user's
 * bubble, the output as the reply, with the model and time where chat puts
 * the agent's name and time. Every studio renders its history with it.
 */
export const StudioTurn: React.FC<StudioTurnProps> = ({
	item,
	request,
	children,
	actions,
	details,
	runningLabel,
	className,
	...data
}) => {
	const { t } = useTranslation("studio");
	const { generation } = item;
	const time = formatTurnTime(item.createdAt);
	const iso = item.createdAt.toISOString();
	const duration =
		generation.status === "done" ? formatDuration(generation.durationMs) : null;

	return (
		<article
			className={cn("space-y-5", className)}
			data-studio-turn={item.id}
			data-status={generation.status}
			aria-busy={generation.status === "running" || undefined}
			{...data}
		>
			<div className="flex flex-col items-end gap-2" data-turn-request>
				<Message from="user">
					<MessageContent>{request}</MessageContent>
				</Message>
				<time
					dateTime={iso}
					className="px-1 text-[11px] text-muted-foreground/80"
				>
					{t("turn.you", { defaultValue: "You" })} · {time}
				</time>
			</div>

			<div className="flex flex-col items-start gap-2" data-turn-response>
				<div
					className="flex items-center justify-start gap-2 px-1 text-xs font-medium tracking-normal text-muted-foreground/80"
					title={`${generation.modelId} · ${providerLabel(generation.provider)}`}
				>
					<span className="max-w-[16rem] truncate">
						{shortModelName({
							id: generation.modelId,
							name: generation.modelId,
						})}
					</span>
					<span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
					<time dateTime={iso}>{time}</time>
				</div>
				<Message from="assistant">
					<div className="relative flex w-full min-w-0 flex-col gap-3 text-sm leading-relaxed text-foreground">
						{children}
						{generation.status === "running" ? (
							<div className="flex items-center gap-2 py-2">
								<ThreeDotsLoader className="text-muted-foreground" />
								<span className="animate-pulse text-muted-foreground">
									{runningLabel ??
										t("common.running", { defaultValue: "Working…" })}
								</span>
							</div>
						) : null}
						{generation.status === "failed" ? (
							<div
								className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
								role="alert"
							>
								<AlertTriangle size={15} className="mt-0.5 shrink-0" />
								<span className="min-w-0 break-words">
									<FailureText error={generation.error} />
								</span>
							</div>
						) : null}
						{generation.status === "cancelled" ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<CircleStop size={14} />
								{t("common.cancelled", { defaultValue: "Stopped" })}
							</div>
						) : null}

						<div
							className="mt-1 border-t border-border/40 pt-2"
							data-generation-status={generation.status}
						>
							<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
								<div className="flex min-w-0 flex-wrap items-center gap-1">
									{actions}
								</div>
								<div className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
									{details}
									{duration ? (
										<span className="rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 tabular-nums">
											{duration}
										</span>
									) : null}
								</div>
							</div>
						</div>
					</div>
				</Message>
			</div>
		</article>
	);
};
