import { Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { Conversation } from "@/services/database/types";
import { ConversationRow } from "../ChatSidePanel/ConversationRow";
import {
	filterConversations,
	groupConversationsByDate,
	isConversationPinned,
} from "../ChatSidePanel/chat-side-panel-utils";

export interface ConversationListLabels {
	search: string;
	create: string;
	empty: string;
	emptyHint: string;
	noSearchResults: string;
	tryAnotherSearch: string;
	/** Heading for a date group ("Pinned", "Today", "Yesterday", "Earlier"). */
	group: (label: string) => string;
}

interface ConversationListProps {
	conversations: readonly Conversation[];
	currentId: string | null | undefined;
	labels: ConversationListLabels;
	createIcon: React.ReactNode;
	onCreate: () => Promise<void> | void;
	onSelect: (conversation: Conversation) => void;
	onRename: (conversation: Conversation, title: string) => void;
	onTogglePin: (conversation: Conversation) => void;
	onDelete: (conversation: Conversation) => void;
	/** Extra attributes on the "new" button, for tests and the co-pilot. */
	createButtonProps?: Record<`data-${string}`, string | boolean>;
}

/**
 * Searchable, date-grouped conversations with a "new" button - the body of a
 * workspace side panel. Presentational: the owner decides what a conversation
 * is and what selecting, renaming or deleting one does.
 */
export const ConversationList: React.FC<ConversationListProps> = ({
	conversations,
	currentId,
	labels,
	createIcon,
	onCreate,
	onSelect,
	onRename,
	onTogglePin,
	onDelete,
	createButtonProps,
}) => {
	const [query, setQuery] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	const groups = useMemo(
		() =>
			groupConversationsByDate(
				filterConversations(Array.from(conversations), query),
			),
		[conversations, query],
	);

	const handleCreate = async () => {
		if (isCreating) return;
		setIsCreating(true);
		try {
			await onCreate();
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-2 px-1 pb-3">
				<label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
					<Search size={14} className="shrink-0" />
					<span className="sr-only">{labels.search}</span>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={labels.search}
						className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
				</label>
				<button
					type="button"
					{...createButtonProps}
					onClick={() => void handleCreate()}
					disabled={isCreating}
					className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{createIcon}
					<span>{labels.create}</span>
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3">
				{groups.length > 0 ? (
					<div className="space-y-4">
						{groups.map((group) => (
							<section
								key={group.label}
								aria-labelledby={`conversation-group-${group.label}`}
							>
								<h2
									id={`conversation-group-${group.label}`}
									className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
								>
									{labels.group(group.label)}
								</h2>
								<div className="space-y-1">
									{group.conversations.map((conversation) => (
										<ConversationRow
											key={conversation.id}
											conversation={conversation}
											isActive={conversation.id === currentId}
											isPinned={isConversationPinned(conversation)}
											onSelect={() => onSelect(conversation)}
											onRename={(title) => onRename(conversation, title)}
											onTogglePin={() => onTogglePin(conversation)}
											onDelete={() => onDelete(conversation)}
										/>
									))}
								</div>
							</section>
						))}
					</div>
				) : (
					<div className="mx-1 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
						<div className="text-sm font-medium text-foreground">
							{query ? labels.noSearchResults : labels.empty}
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							{query ? labels.tryAnotherSearch : labels.emptyHint}
						</p>
					</div>
				)}
			</div>
		</div>
	);
};
