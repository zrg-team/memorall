import {
	Check,
	MoreHorizontal,
	Pencil,
	Pin,
	PinOff,
	Trash2,
	X,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import type { Conversation } from "@/services/database/types";
import {
	formatConversationTime,
	getConversationPreview,
	getConversationTitle,
} from "./chat-side-panel-utils";

interface ConversationRowProps {
	conversation: Conversation;
	isActive: boolean;
	isPinned: boolean;
	onSelect: () => void;
	onRename: (title: string) => void | Promise<void>;
	onTogglePin: () => void | Promise<void>;
	onDelete: () => void;
}

export const ConversationRow: React.FC<ConversationRowProps> = ({
	conversation,
	isActive,
	isPinned,
	onSelect,
	onRename,
	onTogglePin,
	onDelete,
}) => {
	const { t } = useTranslation("chat");
	const inputRef = useRef<HTMLInputElement>(null);
	const [isRenaming, setIsRenaming] = useState(false);
	const [draftTitle, setDraftTitle] = useState(
		getConversationTitle(conversation),
	);

	useEffect(() => {
		if (!isRenaming) {
			setDraftTitle(getConversationTitle(conversation));
		}
	}, [conversation, isRenaming]);

	useEffect(() => {
		if (isRenaming) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [isRenaming]);

	const finishRename = async () => {
		const nextTitle = draftTitle.trim();
		if (nextTitle && nextTitle !== getConversationTitle(conversation)) {
			await onRename(nextTitle);
		}
		setIsRenaming(false);
	};

	if (isRenaming) {
		return (
			<div className="flex items-center gap-1 rounded-lg border border-primary/35 bg-background p-1 shadow-sm">
				<input
					ref={inputRef}
					value={draftTitle}
					onChange={(event) => setDraftTitle(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void finishRename();
						}
						if (event.key === "Escape") {
							setDraftTitle(getConversationTitle(conversation));
							setIsRenaming(false);
						}
					}}
					className="h-9 min-w-0 flex-1 rounded-md border-0 bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label={t("sidebar.renameInput")}
				/>
				<button
					type="button"
					onClick={() => void finishRename()}
					className="inline-flex h-9 w-9 items-center justify-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label={t("sidebar.saveRename")}
				>
					<Check size={15} />
				</button>
				<button
					type="button"
					onClick={() => setIsRenaming(false)}
					className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label={t("sidebar.cancelRename")}
				>
					<X size={15} />
				</button>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"group/row relative flex items-stretch rounded-lg transition-colors hover:bg-muted/50",
				isActive && "bg-muted/60 text-foreground",
			)}
		>
			<button
				type="button"
				onClick={onSelect}
				className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-current={isActive ? "page" : undefined}
			>
				<span className="flex min-w-0 items-center gap-2">
					<span className="min-w-0 flex-1 truncate text-[13px] font-medium">
						{getConversationTitle(conversation)}
					</span>
					{isPinned ? (
						<Pin
							size={11}
							className="shrink-0 text-primary"
							aria-label={t("sidebar.pinned")}
						/>
					) : null}
					<time className="shrink-0 text-[11px] text-muted-foreground transition-opacity group-hover/row:opacity-0">
						{formatConversationTime(conversation)}
					</time>
				</span>
				<span className="mt-0.5 block truncate text-xs text-muted-foreground">
					{getConversationPreview(conversation)}
				</span>
			</button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						className={cn(
							"pointer-events-none absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[background-color,color,opacity]",
							"hover:bg-muted hover:text-foreground group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus:pointer-events-auto focus:bg-background focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						)}
						aria-label={t("sidebar.conversationActions")}
					>
						<MoreHorizontal size={15} />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					<DropdownMenuItem onClick={() => setIsRenaming(true)}>
						<Pencil size={14} />
						<span>{t("sidebar.rename")}</span>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void onTogglePin()}>
						{isPinned ? <PinOff size={14} /> : <Pin size={14} />}
						<span>{isPinned ? t("sidebar.unpin") : t("sidebar.pin")}</span>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={onDelete}
						className="text-destructive focus:text-destructive"
					>
						<Trash2 size={14} />
						<span>{t("sidebar.delete")}</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};
