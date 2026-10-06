import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationCostBadge } from "../ConversationCostBadge";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, fallback?: unknown) => {
			if (typeof fallback === "string") return fallback;
			if (
				fallback &&
				typeof fallback === "object" &&
				"defaultValue" in fallback
			) {
				const { defaultValue, ...vars } = fallback as Record<string, unknown>;
				return String(defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name) =>
					String(vars[name] ?? ""),
				);
			}
			return key;
		},
	}),
}));

const cost = {
	cost: 0.0926,
	inputTokens: 1_704_188,
	cachedTokens: 1_410_880,
	outputTokens: 18_767,
	requests: 42,
	replies: 2,
};

describe("a chat's cost badge", () => {
	it("shows the chat's cost in the header, with what it is made of on hover", () => {
		render(<ConversationCostBadge cost={cost} variant="header" />);
		const badge = screen.getByTestId("chat-cost");
		expect(badge).toHaveTextContent("$0.093");
		expect(badge).toHaveAttribute(
			"title",
			"This chat so far: $0.093\nInput 1.7M tokens (83% from cache) · output 19k\n42 model requests over 2 replies",
		);
	});

	it("says how much of the cost pi code spent on the chat's task", () => {
		render(
			<ConversationCostBadge
				cost={{
					...cost,
					cost: 1.127,
					tools: { cost: 1.037, requests: 120 },
				}}
				variant="header"
			/>,
		);
		const badge = screen.getByTestId("chat-cost");
		expect(badge).toHaveTextContent("$1.13");
		expect(badge.getAttribute("title")).toContain(
			"Of that, tools such as pi code: $1.04 over 120 requests",
		);
	});

	it("shows tokens for a chat whose provider gave no price, and nothing without usage", () => {
		const { rerender } = render(
			<ConversationCostBadge
				cost={{ ...cost, cost: undefined }}
				variant="list"
			/>,
		);
		expect(screen.getByTestId("conversation-cost")).toHaveTextContent(
			"1.7M tokens",
		);
		rerender(<ConversationCostBadge cost={undefined} variant="list" />);
		expect(screen.queryByTestId("conversation-cost")).toBeNull();
	});
});
