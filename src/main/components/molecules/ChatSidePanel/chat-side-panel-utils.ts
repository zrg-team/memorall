import dayjs from "dayjs";
import type { ChatMessageGroup } from "@/main/stores/chat";
import type { Conversation } from "@/services/database/types";

export const getConversationTitle = (conversation: Conversation): string =>
	conversation.title?.trim() || conversation.name?.trim() || "Untitled chat";

const getConversationMetadata = (
	conversation: Conversation,
): Record<string, unknown> =>
	conversation.metadata && typeof conversation.metadata === "object"
		? (conversation.metadata as Record<string, unknown>)
		: {};

export const getConversationPreview = (conversation: Conversation): string => {
	const preview = getConversationMetadata(conversation).lastMessagePreview;
	return typeof preview === "string" && preview.trim()
		? preview.trim()
		: "No messages yet";
};

export const isConversationPinned = (conversation: Conversation): boolean =>
	getConversationMetadata(conversation).pinned === true;

export const getConversationTime = (conversation: Conversation): Date =>
	new Date(conversation.updatedAt ?? conversation.createdAt);

export const getConversationDateLabel = (
	conversation: Conversation,
): "Today" | "Yesterday" | "Earlier" => {
	const value = dayjs(getConversationTime(conversation));
	const today = dayjs();

	if (value.isSame(today, "day")) return "Today";
	if (value.isSame(today.subtract(1, "day"), "day")) return "Yesterday";
	return "Earlier";
};

export interface ConversationDateGroup {
	label: "Pinned" | "Today" | "Yesterday" | "Earlier";
	conversations: Conversation[];
}

export const groupConversationsByDate = (
	conversations: Conversation[],
): ConversationDateGroup[] => {
	const groups = new Map<ConversationDateGroup["label"], Conversation[]>();

	for (const conversation of conversations) {
		const label = isConversationPinned(conversation)
			? "Pinned"
			: getConversationDateLabel(conversation);
		groups.set(label, [...(groups.get(label) ?? []), conversation]);
	}

	return (["Pinned", "Today", "Yesterday", "Earlier"] as const)
		.map((label) => ({ label, conversations: groups.get(label) ?? [] }))
		.filter((group) => group.conversations.length > 0);
};

export const filterConversations = (
	conversations: Conversation[],
	query: string,
): Conversation[] => {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return conversations;

	return conversations.filter((conversation) =>
		[getConversationTitle(conversation), getConversationPreview(conversation)]
			.join(" ")
			.toLowerCase()
			.includes(normalizedQuery),
	);
};

export const formatConversationTime = (conversation: Conversation): string => {
	const value = dayjs(getConversationTime(conversation));
	const today = dayjs();

	if (value.isSame(today, "day")) return value.format("h:mm A");
	if (value.isSame(today.subtract(1, "day"), "day")) return "Yesterday";
	return value.format("MMM D");
};

export const formatGroupTitle = (group: ChatMessageGroup): string => {
	if (group.isLatest) return "Current context";
	if (!group.separator) return "Earlier context";
	return dayjs(group.separator.createdAt).format("MMM D, h:mm A");
};

export const formatGroupMeta = (group: ChatMessageGroup): string => {
	if (group.isLoading) return "Loading messages";
	if (!group.isLatest && !group.isLoaded) return "Load messages";

	const count = group.messages.length;
	return `${count} ${count === 1 ? "message" : "messages"}`;
};
