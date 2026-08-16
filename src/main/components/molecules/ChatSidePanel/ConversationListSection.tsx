import React, { useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/main/stores/chat";
import type { Conversation } from "@/services/database/types";
import { ConversationRow } from "./ConversationRow";
import {
	filterConversations,
	getConversationTitle,
	groupConversationsByDate,
	isConversationPinned,
} from "./chat-side-panel-utils";

export const ConversationListSection: React.FC = () => {
	const conversations = useChatStore((state) => state.conversations);
	const currentConversation = useChatStore(
		(state) => state.currentConversation,
	);
	const createNewConversation = useChatStore(
		(state) => state.createNewConversation,
	);
	const loadConversation = useChatStore((state) => state.loadConversation);
	const loadConversations = useChatStore((state) => state.loadConversations);
	const renameConversation = useChatStore((state) => state.renameConversation);
	const toggleConversationPinned = useChatStore(
		(state) => state.toggleConversationPinned,
	);
	const deleteConversation = useChatStore((state) => state.deleteConversation);
	const { t } = useTranslation("chat");
	const [query, setQuery] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	useEffect(() => {
		void loadConversations();
	}, [loadConversations]);

	const visibleConversations = useMemo(() => {
		const byId = new Map(conversations.map((item) => [item.id, item]));
		if (currentConversation) {
			byId.set(currentConversation.id, currentConversation);
		}
		return filterConversations(Array.from(byId.values()), query);
	}, [conversations, currentConversation, query]);

	const conversationGroups = useMemo(
		() => groupConversationsByDate(visibleConversations),
		[visibleConversations],
	);

	const handleNewConversation = async () => {
		if (isCreating) return;
		setIsCreating(true);
		try {
			await createNewConversation();
			await loadConversations();
		} finally {
			setIsCreating(false);
		}
	};

	const handleDeleteConversation = async (conversation: Conversation) => {
		const confirmed = window.confirm(
			t("sidebar.deleteConfirm", {
				title: getConversationTitle(conversation),
			}),
		);
		if (!confirmed) return;
		await deleteConversation(conversation.id);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-2 px-1 pb-3">
				<label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
					<Search size={14} className="shrink-0" />
					<span className="sr-only">{t("sidebar.search")}</span>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("sidebar.search")}
						className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					/>
				</label>
				<button
					type="button"
					data-new-chat
					onClick={() => void handleNewConversation()}
					disabled={isCreating}
					className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<MessageSquarePlus size={15} />
					<span>{t("sidebar.newChat")}</span>
				</button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3">
				{conversationGroups.length > 0 ? (
					<div className="space-y-4">
						{conversationGroups.map((group) => (
							<section
								key={group.label}
								aria-labelledby={`chat-group-${group.label}`}
							>
								<h2
									id={`chat-group-${group.label}`}
									className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
								>
									{t(`sidebar.groups.${group.label.toLowerCase()}`)}
								</h2>
								<div className="space-y-1">
									{group.conversations.map((conversation) => (
										<ConversationRow
											key={conversation.id}
											conversation={conversation}
											isActive={conversation.id === currentConversation?.id}
											isPinned={isConversationPinned(conversation)}
											onSelect={() => {
												if (conversation.id !== currentConversation?.id) {
													void loadConversation(conversation.id);
												}
											}}
											onRename={(title) =>
												renameConversation(conversation.id, title)
											}
											onTogglePin={() =>
												toggleConversationPinned(conversation.id)
											}
											onDelete={() =>
												void handleDeleteConversation(conversation)
											}
										/>
									))}
								</div>
							</section>
						))}
					</div>
				) : (
					<div className="mx-1 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
						<div className="text-sm font-medium text-foreground">
							{query ? t("sidebar.noSearchResults") : t("sidebar.empty")}
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							{query ? t("sidebar.tryAnotherSearch") : t("sidebar.emptyHint")}
						</p>
					</div>
				)}
			</div>
		</div>
	);
};
