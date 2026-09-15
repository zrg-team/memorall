import { MessageSquarePlus } from "lucide-react";
import type React from "react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/main/stores/chat";
import { ConversationList } from "../WorkspaceSidePanel/ConversationList";
import { getConversationTitle } from "./chat-side-panel-utils";

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

	useEffect(() => {
		void loadConversations();
	}, [loadConversations]);

	// The open conversation is listed even before it is saved to the list.
	const visibleConversations = useMemo(() => {
		const byId = new Map(conversations.map((item) => [item.id, item]));
		if (currentConversation) {
			byId.set(currentConversation.id, currentConversation);
		}
		return Array.from(byId.values());
	}, [conversations, currentConversation]);

	return (
		<ConversationList
			conversations={visibleConversations}
			currentId={currentConversation?.id}
			labels={{
				search: t("sidebar.search"),
				create: t("sidebar.newChat"),
				empty: t("sidebar.empty"),
				emptyHint: t("sidebar.emptyHint"),
				noSearchResults: t("sidebar.noSearchResults"),
				tryAnotherSearch: t("sidebar.tryAnotherSearch"),
				group: (label) => t(`sidebar.groups.${label.toLowerCase()}`),
			}}
			createIcon={<MessageSquarePlus size={15} />}
			createButtonProps={{ "data-new-chat": true }}
			onCreate={async () => {
				await createNewConversation();
				await loadConversations();
			}}
			onSelect={(conversation) => {
				if (conversation.id !== currentConversation?.id) {
					void loadConversation(conversation.id);
				}
			}}
			onRename={(conversation, title) =>
				renameConversation(conversation.id, title)
			}
			onTogglePin={(conversation) => toggleConversationPinned(conversation.id)}
			onDelete={(conversation) => {
				const confirmed = window.confirm(
					t("sidebar.deleteConfirm", {
						title: getConversationTitle(conversation),
					}),
				);
				if (confirmed) void deleteConversation(conversation.id);
			}}
		/>
	);
};
