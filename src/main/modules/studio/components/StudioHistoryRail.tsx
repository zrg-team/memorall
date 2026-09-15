import { History, Plus } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { getConversationTitle } from "@/main/components/molecules/ChatSidePanel/chat-side-panel-utils";
import { ConversationList } from "@/main/components/molecules/WorkspaceSidePanel/ConversationList";
import { WorkspaceSidePanel } from "@/main/components/molecules/WorkspaceSidePanel/WorkspaceSidePanel";
import { useStudioStore } from "@/main/stores/studio";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import { studioModeDescriptor } from "../studio-modes";

interface StudioHistoryRailProps {
	mode: MediaCategory;
	/** Drawer use (narrow panels): no collapse or resize, a close button. */
	onClose?: () => void;
}

/**
 * Sessions of one studio - chat's side panel and conversation list, bound to
 * the studio store, so history looks and behaves the same in every workspace.
 */
export const StudioHistoryRail: React.FC<StudioHistoryRailProps> = ({
	mode,
	onClose,
}) => {
	const { t } = useTranslation("studio");
	const { t: tChat } = useTranslation("chat");
	const state = useStudioStore((store) => store.modes[mode]);
	const openConversation = useStudioStore((store) => store.openConversation);
	const newConversation = useStudioStore((store) => store.newConversation);
	const renameConversation = useStudioStore(
		(store) => store.renameConversation,
	);
	const togglePinned = useStudioStore((store) => store.togglePinned);
	const deleteConversation = useStudioStore(
		(store) => store.deleteConversation,
	);
	const conversations = state?.conversations ?? [];
	const modeLabel = t(`modes.${mode}.label`, {
		defaultValue: studioModeDescriptor(mode).label,
	});
	const drawer = Boolean(onClose);

	const create = () => {
		newConversation(mode);
		onClose?.();
	};

	return (
		<div className="h-full" data-studio-history={mode}>
			<WorkspaceSidePanel
				storageKey="studioSidebar"
				labels={{
					region: t("history.label", {
						mode: modeLabel,
						defaultValue: `${modeLabel} sessions`,
					}),
					title: t("history.title", { defaultValue: "Sessions" }),
					count: t("history.count", {
						count: conversations.length,
						defaultValue: `${conversations.length} sessions`,
					}),
					expand: t("history.expand", { defaultValue: "Expand sessions" }),
					collapse: t("history.collapse", {
						defaultValue: "Collapse sessions",
					}),
					close: t("history.close", { defaultValue: "Close sessions" }),
					resize: t("history.resize", { defaultValue: "Resize sessions" }),
					create: t("history.newSession", { defaultValue: "New session" }),
				}}
				itemCount={conversations.length}
				railIcon={<History size={17} />}
				createIcon={<Plus size={17} />}
				onCreate={create}
				allowCollapse={!drawer}
				allowResize={!drawer}
				onClose={onClose}
			>
				<ConversationList
					conversations={conversations}
					currentId={state?.currentConversationId}
					labels={{
						search: t("history.search", { defaultValue: "Search sessions" }),
						create: t("history.new", { defaultValue: "New" }),
						empty: t("history.emptyTitle", {
							defaultValue: "No sessions yet",
						}),
						emptyHint: t("history.empty", {
							defaultValue: "Your generations will appear here.",
						}),
						noSearchResults: t("history.noSearchResults", {
							defaultValue: "No matching sessions",
						}),
						tryAnotherSearch: tChat("sidebar.tryAnotherSearch"),
						group: (label) =>
							t(`history.groups.${label}`, { defaultValue: label }),
					}}
					createIcon={<Plus size={15} />}
					createButtonProps={{ "data-studio-new-session": true }}
					onCreate={create}
					onSelect={(conversation) => {
						void openConversation(mode, conversation.id);
						onClose?.();
					}}
					onRename={(conversation, title) =>
						renameConversation(mode, conversation.id, title)
					}
					onTogglePin={(conversation) => togglePinned(mode, conversation.id)}
					onDelete={(conversation) => {
						const confirmed = window.confirm(
							tChat("sidebar.deleteConfirm", {
								title: getConversationTitle(conversation),
							}),
						);
						if (confirmed) void deleteConversation(mode, conversation.id);
					}}
				/>
			</WorkspaceSidePanel>
		</div>
	);
};
