import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/services/database/types";
import { MessageFooter, type MessageFooterMetadata } from "../MessageFooter";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, fallback?: unknown) =>
			typeof fallback === "string" ? fallback : key,
	}),
}));

vi.mock("../DocumentSaveFolderDialog", () => ({
	DocumentSaveFolderDialog: () => null,
}));

const message = {
	id: "m1",
	conversationId: "c1",
	type: "text",
	role: "assistant",
	content: "answer",
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

const renderFooter = (usage: MessageFooterMetadata["usage"]) => {
	render(
		<MessageFooter
			message={message}
			groupMessages={[message]}
			metadata={{
				model: "gpt-5.6-terra",
				provider: "openai",
				timeToAnswer: 2,
				tokensPerSecond: 10,
				estimatedTokens: 2150,
				usage,
			}}
		/>,
	);
	fireEvent.click(screen.getByText("Response details"));
};

describe("MessageFooter token usage", () => {
	it("shows the cache hit rate and the per-request breakdown", () => {
		renderFooter({
			prompt_tokens: 2100,
			completion_tokens: 50,
			total_tokens: 2150,
			cached_tokens: 1000,
			cache_write_tokens: 1000,
			cost: 0.0123,
			requests: 2,
			calls: [
				{
					prompt_tokens: 1000,
					completion_tokens: 20,
					total_tokens: 1020,
					cached_tokens: 0,
					cache_write_tokens: 1000,
				},
				{
					prompt_tokens: 1100,
					completion_tokens: 30,
					total_tokens: 1130,
					cached_tokens: 1000,
				},
			],
		});

		expect(screen.getByTestId("message-cache-chip")).toHaveTextContent(
			"Cache hit 48%",
		);
		const details = screen.getByTestId("message-usage-details");
		expect(details).toHaveTextContent("Cached1,000 (48%)");
		expect(details).toHaveTextContent("Cache write1,000");
		expect(details).toHaveTextContent("Cost$0.0123");
		expect(details).toHaveTextContent("Requests2");
		expect(details).toHaveTextContent("#1Input 1,000Cached 0 (0%)");
		expect(details).toHaveTextContent("#2Input 1,100Cached 1,000 (91%)");
	});

	it("says so when the provider reported no cache data", () => {
		renderFooter({
			prompt_tokens: 300,
			completion_tokens: 10,
			total_tokens: 310,
		});

		expect(screen.getByTestId("message-cache-chip")).toHaveTextContent(
			"Cache hit -",
		);
		expect(screen.getByTestId("message-usage-details")).toHaveTextContent(
			"The provider reported no prompt-cache data",
		);
	});

	it("marks locally estimated usage", () => {
		renderFooter({
			prompt_tokens: 300,
			completion_tokens: 10,
			total_tokens: 310,
			estimated: true,
		});

		expect(screen.getByText("~2,150 tokens")).toBeInTheDocument();
		expect(screen.getByTestId("message-usage-details")).toHaveTextContent(
			"Estimated locally, the provider sent no usage",
		);
	});

	it("renders the legacy chips alone when a message has no usage", () => {
		renderFooter(undefined);

		expect(screen.getByText("2,150 tokens")).toBeInTheDocument();
		expect(screen.queryByTestId("message-cache-chip")).toBeNull();
		expect(screen.queryByTestId("message-usage-details")).toBeNull();
	});
});
