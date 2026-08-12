import { describe, expect, it } from "vitest";
import type { Conversation } from "@/services/database/types";
import {
	filterConversations,
	getConversationPreview,
	groupConversationsByDate,
	isConversationPinned,
} from "../chat-side-panel-utils";

const conversation = (
	id: string,
	title: string,
	updatedAt: Date,
	metadata: Record<string, unknown> = {},
): Conversation =>
	({
		id,
		title,
		name: null,
		agentFlowId: null,
		metadata,
		createdAt: updatedAt,
		updatedAt,
	}) as Conversation;

describe("chat side panel utilities", () => {
	it("groups pinned and dated conversations in a stable order", () => {
		const now = new Date();
		const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		const earlier = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
		const items = [
			conversation("today", "Today", now),
			conversation("pinned", "Pinned", earlier, { pinned: true }),
			conversation("yesterday", "Yesterday", yesterday),
			conversation("earlier", "Earlier", earlier),
		];

		expect(groupConversationsByDate(items)).toMatchObject([
			{ label: "Pinned", conversations: [{ id: "pinned" }] },
			{ label: "Today", conversations: [{ id: "today" }] },
			{ label: "Yesterday", conversations: [{ id: "yesterday" }] },
			{ label: "Earlier", conversations: [{ id: "earlier" }] },
		]);
	});

	it("filters by title or generated preview and reads pinned metadata", () => {
		const item = conversation("research", "Quarterly brief", new Date(), {
			lastMessagePreview: "Supplier margin risks",
			pinned: true,
		});

		expect(filterConversations([item], "quarterly")).toEqual([item]);
		expect(filterConversations([item], "margin")).toEqual([item]);
		expect(filterConversations([item], "missing")).toEqual([]);
		expect(getConversationPreview(item)).toBe("Supplier margin risks");
		expect(isConversationPinned(item)).toBe(true);
	});
});
