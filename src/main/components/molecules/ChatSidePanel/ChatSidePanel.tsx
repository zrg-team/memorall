import { MessageSquare, MessageSquarePlus } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/main/stores/chat";
import { WorkspaceSidePanel } from "../WorkspaceSidePanel/WorkspaceSidePanel";
import { ConversationListSection } from "./ConversationListSection";

interface ChatSidePanelProps {
	onShowConversationGroup?: (groupId: string) => void;
	defaultCollapsed?: boolean;
	allowCollapse?: boolean;
	allowResize?: boolean;
	onClose?: () => void;
}

export const ChatSidePanel: React.FC<ChatSidePanelProps> = ({
	defaultCollapsed = false,
	allowCollapse = true,
	allowResize = true,
	onClose,
}) => {
	const conversations = useChatStore((state) => state.conversations);
	const currentConversation = useChatStore(
		(state) => state.currentConversation,
	);
	const createNewConversation = useChatStore(
		(state) => state.createNewConversation,
	);
	const loadConversations = useChatStore((state) => state.loadConversations);
	const { t } = useTranslation("chat");
	const conversationCount = Math.max(
		conversations.length,
		currentConversation ? 1 : 0,
	);

	return (
		<WorkspaceSidePanel
			storageKey="chatSidebar"
			labels={{
				region: t("sidebar.label"),
				title: t("sidebar.title"),
				count: t("sidebar.count", { count: conversationCount }),
				expand: t("sidebar.expand"),
				collapse: t("sidebar.collapse"),
				close: t("sidebar.close"),
				resize: t("sidebar.resize"),
				create: t("sidebar.newChat"),
			}}
			itemCount={conversationCount}
			railIcon={<MessageSquare size={17} />}
			createIcon={<MessageSquarePlus size={17} />}
			onCreate={() =>
				void createNewConversation().then(() => loadConversations())
			}
			defaultCollapsed={defaultCollapsed}
			allowCollapse={allowCollapse}
			allowResize={allowResize}
			onClose={onClose}
		>
			<ConversationListSection />
		</WorkspaceSidePanel>
	);
};
