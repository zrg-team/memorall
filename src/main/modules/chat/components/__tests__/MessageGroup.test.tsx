import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageGroup } from "../MessageGroup";
import type { ChatMessageGroup } from "@/main/stores/chat";
import type { Message } from "@/services/database/types";

const rendererCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			key === "messages.count" ? `${values?.count} messages` : key,
	}),
}));

vi.mock("@/components/AgentIcon", () => ({
	AgentIcon: () => <div data-testid="agent-icon" />,
}));

vi.mock("../MessageRenderer", () => ({
	MessageRenderer: () => {
		rendererCalls.count += 1;
		return <div data-testid="message-renderer" />;
	},
}));

const buildMessage = (contentGetter: () => string): Message => {
	const message = {
		id: "m1",
		conversationId: "c1",
		type: "text",
		role: "assistant",
		complexContent: null,
		parts: null,
		topicId: null,
		embedding: null,
		embeddingSmall: null,
		embeddingLarge: null,
		metadata: {},
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	} as Message;

	Object.defineProperty(message, "content", {
		configurable: true,
		enumerable: true,
		get: contentGetter,
	});

	return message;
};

describe("MessageGroup", () => {
	beforeEach(() => {
		rendererCalls.count = 0;
	});

	it("does not compute message render trees while a loaded completed group is collapsed", () => {
		let contentReads = 0;
		const group: ChatMessageGroup = {
			id: "g1",
			previousSeparator: null,
			separator: null,
			messages: [
				buildMessage(() => {
					contentReads += 1;
					return "message";
				}),
			],
			isLatest: false,
			isLoaded: true,
			isLoading: false,
		};

		render(<MessageGroup group={group} defaultCollapsed={true} />);

		expect(contentReads).toBe(0);
		expect(rendererCalls.count).toBe(0);

		fireEvent.click(screen.getByText("1 messages").closest("div")!);

		expect(contentReads).toBeGreaterThan(0);
		expect(screen.getByTestId("message-renderer")).toBeInTheDocument();
	});
});
