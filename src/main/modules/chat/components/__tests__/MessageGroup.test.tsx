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

const rendererCalls = vi.hoisted(() => ({
	count: 0,
	renders: new Map<string, number>(),
	mounts: new Map<string, number>(),
	props: new Map<string, Record<string, unknown>>(),
}));

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

// Memoized like the real one, so a test sees which rows render again.
vi.mock("../MessageRenderer", async () => {
	const ReactModule = await import("react");
	const MessageRenderer = (props: {
		message: Message;
		isLastMessage: boolean;
		isStreaming: boolean;
	}) => {
		const { message, isLastMessage, isStreaming } = props;
		rendererCalls.count += 1;
		const count = (map: Map<string, number>) =>
			map.set(message.id, (map.get(message.id) ?? 0) + 1);
		count(rendererCalls.renders);
		rendererCalls.props.set(message.id, props);
		ReactModule.useEffect(() => {
			count(rendererCalls.mounts);
		}, []);
		return (
			<div
				data-testid="message-renderer"
				data-id={message.id}
				data-last={String(isLastMessage)}
				data-streaming={String(isStreaming)}
			/>
		);
	};
	return { MessageRenderer: ReactModule.memo(MessageRenderer) };
});

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

describe("a reply its iteration limit cut off", () => {
	const reply = (id: string, metadata: Record<string, unknown>): Message =>
		({
			...buildCoAgentMessage(id, "https://example.com"),
			content: "",
			metadata,
		}) as Message;

	const latest = (messages: Message[]): ChatMessageGroup => ({
		id: "g-latest",
		previousSeparator: null,
		separator: null,
		messages,
		isLatest: true,
		isLoaded: true,
		isLoading: false,
	});

	it("is shown even with nothing else to show, as the chat's newest message", () => {
		render(
			<MessageGroup
				group={latest([
					buildMessage(() => "earlier answer"),
					reply("cut-off", { iterationLimit: 50 }),
				])}
				defaultCollapsed={false}
			/>,
		);

		const renderers = screen.getAllByTestId("message-renderer");
		expect(renderers.map((el) => el.dataset.last)).toEqual(["false", "true"]);
		expect(renderers[1].dataset.id).toBe("cut-off");
	});

	it("is not the newest message while a reply streams after it", () => {
		render(
			<MessageGroup
				group={latest([reply("cut-off", { iterationLimit: 50 })])}
				inProgressMessage={{
					id: "next",
					conversationId: "c1",
					content: "",
					complexContent: null,
					parts: null,
					actions: [],
				}}
				defaultCollapsed={false}
			/>,
		);

		const cutOff = screen
			.getAllByTestId("message-renderer")
			.find((el) => el.dataset.id === "cut-off");
		expect(cutOff?.dataset.last).toBe("false");
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

describe("a reply streaming into the group", () => {
	beforeEach(() => {
		rendererCalls.count = 0;
		rendererCalls.renders.clear();
		rendererCalls.mounts.clear();
		rendererCalls.props.clear();
	});

	const row = (
		id: string,
		role: Message["role"],
		content: string,
		metadata: Record<string, unknown> = {},
	): Message =>
		({
			...buildCoAgentMessage(id, "https://example.com"),
			role,
			content,
			metadata,
		}) as Message;

	const latest = (messages: Message[]): ChatMessageGroup => ({
		id: "g-latest",
		previousSeparator: null,
		separator: null,
		messages,
		isLatest: true,
		isLoaded: true,
		isLoading: false,
	});

	const streaming = (content: string) => ({
		id: "a2",
		conversationId: "c1",
		content,
		complexContent: null,
		parts: null,
		actions: [],
	});

	const onMessageAction = vi.fn();
	const question = row("u1", "user", "question");
	const answer = row("a1", "assistant", "answer");
	const followUp = row("u2", "user", "follow-up");
	// The run saves its reply's row before a word of it has arrived.
	const placeholder = row("a2", "assistant", "");

	it("stays mounted when the reply finishes, in the row it streamed in", () => {
		const { rerender } = render(
			<MessageGroup
				group={latest([question, answer, followUp, placeholder])}
				inProgressMessage={streaming("partial")}
				onMessageAction={onMessageAction}
			/>,
		);
		expect(
			screen.getAllByTestId("message-renderer").map((el) => el.dataset.id),
		).toEqual(["u1", "a1", "u2", "a2"]);

		rerender(
			<MessageGroup
				group={latest([
					question,
					answer,
					followUp,
					{ ...placeholder, content: "final" } as Message,
				])}
				inProgressMessage={null}
				onMessageAction={onMessageAction}
			/>,
		);

		const finished = screen
			.getAllByTestId("message-renderer")
			.find((el) => el.dataset.id === "a2");
		expect(finished?.dataset.streaming).toBe("false");
		// Rendered again in place, not mounted anew.
		expect(rendererCalls.mounts.get("a2")).toBe(1);
	});

	it("renders only the streaming row as the reply grows", () => {
		const group = latest([question, answer, followUp, placeholder]);
		const { rerender } = render(
			<MessageGroup
				group={group}
				inProgressMessage={streaming("par")}
				onMessageAction={onMessageAction}
			/>,
		);
		for (const next of ["part", "parti", "partial"]) {
			rerender(
				<MessageGroup
					group={group}
					inProgressMessage={streaming(next)}
					onMessageAction={onMessageAction}
				/>,
			);
		}

		expect(rendererCalls.renders.get("u1")).toBe(1);
		expect(rendererCalls.renders.get("a1")).toBe(1);
		expect(rendererCalls.renders.get("u2")).toBe(1);
		expect(rendererCalls.renders.get("a2")).toBe(4);
	});

	it("hands a reply the one before it, and the group as it is when read", () => {
		const second = row("a2", "assistant", "second answer");
		const { rerender } = render(
			<MessageGroup
				group={latest([question, answer, followUp, second])}
				onMessageAction={onMessageAction}
			/>,
		);
		expect(rendererCalls.props.get("a2")?.previousAssistantMessage).toBe(
			answer,
		);
		expect(rendererCalls.props.get("a1")?.previousAssistantMessage).toBe(
			undefined,
		);

		const later = row("u3", "user", "one more");
		rerender(
			<MessageGroup
				group={latest([question, answer, followUp, second, later])}
				onMessageAction={onMessageAction}
			/>,
		);

		// The earlier rows did not render again for the new message, yet what
		// their footer saves is the group as it now stands.
		expect(rendererCalls.renders.get("a1")).toBe(1);
		const getGroupMessages = rendererCalls.props.get("a1")
			?.getGroupMessages as () => Message[];
		expect(getGroupMessages().map((message) => message.id)).toEqual([
			"u1",
			"a1",
			"u2",
			"a2",
			"u3",
		]);
	});
});
