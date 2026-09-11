import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
	COAGENT_SESSION_END,
	COAGENT_SESSION_START,
} from "@/services/chat/coagent-session";
import type { Message } from "@/services/database/types";
import { MessageRenderer } from "../MessageRenderer";

// Reaching MessageRenderer drags in the whole integrations tree — PDF
// extraction, a virtual filesystem, IndexedDB — none of which this render
// path uses.
vi.mock("@/services/flows-integrations", () => ({}));
vi.mock("@/services/filesystem/fs", () => ({
	fs: {},
	configureFilesystem: async () => {},
}));
vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: {},
	getDocument: () => ({ promise: Promise.resolve(null) }),
	OPS: {
		paintImageXObject: 1,
		paintImageXObjectRepeat: 2,
		paintInlineImageXObject: 3,
	},
	version: "0",
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			(values?.defaultValue as string) ?? key,
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
	Trans: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock("@/components/AgentIcon", () => ({
	AgentIcon: () => <div data-testid="agent-icon" />,
}));

const marker = (type: string): Message =>
	({
		id: `marker-${type}`,
		conversationId: "c1",
		type,
		role: "system",
		// The marker carries no prose; it exists only to be drawn.
		content: "",
		complexContent: null,
		parts: null,
		topicId: null,
		embedding: null,
		embeddingSmall: null,
		embeddingLarge: null,
		metadata: { source: "co-agent" },
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	}) as Message;

const renderMarker = (type: string) =>
	render(
		<MemoryRouter>
			<MessageRenderer
				message={marker(type)}
				index={0}
				isLastMessage={false}
				isStreaming={false}
			/>
		</MemoryRouter>,
	);

/**
 * The co-agent writes its page turns into the same conversation as the chat
 * panel, so without a boundary the transcript gives no clue which turns came
 * from a web page. These assert the boundary is actually drawn — an empty
 * system message is easy to drop by accident on the way to the screen.
 */
describe("co-agent session divider", () => {
	it("draws a labelled start boundary", () => {
		const { container } = renderMarker(COAGENT_SESSION_START);

		expect(container.textContent).toContain("Co-agent session started");
	});

	it("draws a labelled end boundary", () => {
		const { container } = renderMarker(COAGENT_SESSION_END);

		expect(container.textContent).toContain("Co-agent session ended");
	});

	it("renders rules either side of the label", () => {
		const { container } = renderMarker(COAGENT_SESSION_START);

		// Two hairlines flanking the pill are what makes it read as a divider
		// rather than as a stray message.
		expect(container.querySelectorAll(".h-px")).toHaveLength(2);
	});

	it("does not render the marker as an empty message bubble", () => {
		const { container } = renderMarker(COAGENT_SESSION_START);

		expect(container.querySelector("[data-message-content]")).toBeNull();
	});
});

const userTurn = (metadata: Record<string, unknown>): Message =>
	({
		id: "u1",
		conversationId: "c1",
		type: "text",
		role: "user",
		content: "Hi what is this ?",
		complexContent: null,
		parts: null,
		topicId: null,
		embedding: null,
		embeddingSmall: null,
		embeddingLarge: null,
		metadata,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
	}) as Message;

const renderTurn = (message: Message) =>
	render(
		<MemoryRouter>
			<MessageRenderer
				message={message}
				index={0}
				isLastMessage={false}
				isStreaming={false}
			/>
		</MemoryRouter>,
	);

/**
 * What the composer showed before sending has to survive the send. A region
 * can be shown back as a picture; text and HTML cannot, because being long is
 * why they were attached — so the chip stands in for them.
 */
describe("what a co-agent turn carried", () => {
	it("shows the chip for a captured region", () => {
		const { container } = renderTurn(
			userTurn({
				source: "co-agent",
				attachedContexts: [{ kind: "screenshot", label: "Region 641×482" }],
			}),
		);

		expect(container.textContent).toContain("Region 641×482");
	});

	it("shows picked text and markup, which cannot be shown back in full", () => {
		const { container } = renderTurn(
			userTurn({
				source: "co-agent",
				attachedContexts: [
					{ kind: "text", label: "Smart Text: <p> Some prose" },
					{ kind: "html", label: "Clean HTML: <table>" },
				],
			}),
		);

		expect(container.textContent).toContain("Smart Text");
		expect(container.textContent).toContain("Clean HTML");
	});

	it("shows the hovered element the question was about", () => {
		const { container } = renderTurn(
			userTurn({
				source: "co-agent",
				attachedContexts: [{ kind: "anchor", label: "<div> a listing" }],
			}),
		);

		expect(container.textContent).toContain("a listing");
	});

	it("keeps the typed question readable beside the chips", () => {
		const { container } = renderTurn(
			userTurn({
				source: "co-agent",
				attachedContexts: [{ kind: "screenshot", label: "Region 641×482" }],
			}),
		);

		expect(container.textContent).toContain("Hi what is this ?");
	});

	it("adds nothing to a turn that carried nothing", () => {
		const { container } = renderTurn(userTurn({ source: "co-agent" }));

		expect(
			container.querySelector('[data-testid="message-attached-contexts"]'),
		).toBeNull();
	});
});
