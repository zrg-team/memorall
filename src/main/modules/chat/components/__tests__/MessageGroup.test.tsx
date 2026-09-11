import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageGroup } from "../MessageGroup";
import type { ChatMessageGroup } from "@/main/stores/chat";
import type { Message } from "@/services/database/types";
import {
	COAGENT_SESSION_END,
	COAGENT_SESSION_START,
} from "@/services/chat/coagent-session";

const rendererCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		// Interpolates like the real one, so a label built from a page name can
		// actually be asserted rather than coming back as its key.
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "messages.count") return `${values?.count} messages`;
			const template = (values?.defaultValue as string | undefined) ?? key;
			return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
				String(values?.[name] ?? ""),
			);
		},
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

const buildCoAgentMessage = (id: string, pageUrl: string): Message =>
	({
		id,
		conversationId: "c1",
		type: "text",
		role: "assistant",
		content: "a page turn",
		complexContent: null,
		parts: null,
		topicId: null,
		embedding: null,
		embeddingSmall: null,
		embeddingLarge: null,
		metadata: { source: "co-agent", pageUrl, pageTitle: "Listing" },
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	}) as Message;

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

		fireEvent.click(screen.getByRole("button", { name: /1 messages/i }));

		expect(contentReads).toBeGreaterThan(0);
		expect(screen.getByTestId("message-renderer")).toBeInTheDocument();
	});
});

describe("co-agent session boundaries in a group", () => {
	beforeEach(() => {
		rendererCalls.count = 0;
	});

	const marker = (type: string): Message =>
		({
			id: `marker-${type}`,
			conversationId: "c1",
			type,
			role: "system",
			// No prose: the marker exists only to be drawn as a divider.
			content: "",
			complexContent: null,
			parts: null,
			topicId: null,
			embedding: null,
			embeddingSmall: null,
			embeddingLarge: null,
			metadata: { source: "co-agent", url: "https://example.com/a" },
			createdAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		}) as Message;

	const groupWith = (messages: Message[]): ChatMessageGroup => ({
		id: "g-markers",
		previousSeparator: null,
		separator: null,
		messages,
		isLatest: true,
		isLoaded: true,
		isLoading: false,
	});

	it("renders a session boundary even though it carries no text", () => {
		// The empty-content guard used to drop these before the renderer saw
		// them, so the divider could never appear however correct the renderer was.
		render(
			<MessageGroup
				group={groupWith([marker(COAGENT_SESSION_START)])}
				defaultCollapsed={false}
			/>,
		);

		expect(rendererCalls.count).toBe(1);
	});

	it("renders both ends of a session around its messages", () => {
		render(
			<MessageGroup
				group={groupWith([
					marker(COAGENT_SESSION_START),
					buildMessage(() => "a page turn"),
					marker(COAGENT_SESSION_END),
				])}
				defaultCollapsed={false}
			/>,
		);

		expect(rendererCalls.count).toBe(3);
	});

	it("still drops a genuinely empty message", () => {
		const empty = buildMessage(() => "");
		render(
			<MessageGroup group={groupWith([empty])} defaultCollapsed={false} />,
		);

		expect(rendererCalls.count).toBe(0);
	});
});

describe("the route a co-agent session took", () => {
	beforeEach(() => {
		rendererCalls.count = 0;
	});

	const PAGE_A = "https://batdongsan.com.vn/nha-1";
	const PAGE_B = "https://batdongsan.com.vn/nha-2";

	const groupWith = (messages: Message[]): ChatMessageGroup => ({
		id: "g-route",
		previousSeparator: null,
		separator: null,
		messages,
		isLatest: true,
		isLoaded: true,
		isLoading: false,
	});

	const dividers = () =>
		Array.from(
			document.querySelectorAll('[data-testid="coagent-page-divider"]'),
		);

	it("says where a run of co-agent turns was asked", () => {
		render(
			<MessageGroup
				group={groupWith([buildCoAgentMessage("m1", PAGE_A)])}
				defaultCollapsed={false}
			/>,
		);

		expect(dividers()).toHaveLength(1);
		expect(dividers()[0].textContent).toContain("nha-1");
	});

	it("marks the move when the session follows a link", () => {
		render(
			<MessageGroup
				group={groupWith([
					buildCoAgentMessage("m1", PAGE_A),
					buildCoAgentMessage("m2", PAGE_A),
					buildCoAgentMessage("m3", PAGE_B),
				])}
				defaultCollapsed={false}
			/>,
		);

		// Two steps in the route, not one chip per turn.
		expect(dividers()).toHaveLength(2);
		expect(dividers()[1].textContent).toContain("nha-2");
	});

	it("leaves a conversation typed in the panel alone", () => {
		render(
			<MessageGroup
				group={groupWith([buildMessage(() => "typed here")])}
				defaultCollapsed={false}
			/>,
		);

		expect(dividers()).toHaveLength(0);
	});

	it("computes no route while the group is collapsed", () => {
		render(
			<MessageGroup
				group={{
					...groupWith([buildCoAgentMessage("m1", PAGE_A)]),
					isLatest: false,
				}}
				defaultCollapsed={true}
			/>,
		);

		expect(dividers()).toHaveLength(0);
	});
});
