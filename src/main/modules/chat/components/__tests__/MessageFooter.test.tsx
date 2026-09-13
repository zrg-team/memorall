import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/services/database/types";
import { MessageFooter, type MessageFooterMetadata } from "../MessageFooter";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		// Mirrors i18next closely enough for these tests: a string fallback is
		// used as-is, and an options object's defaultValue is interpolated.
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
		expect(screen.getByTestId("usage-input")).toHaveTextContent("2,100");
		expect(screen.getByTestId("usage-cached")).toHaveTextContent("1,000");
		expect(screen.getByTestId("usage-cached")).toHaveTextContent("48%");
		expect(screen.getByTestId("usage-cost")).toHaveTextContent("$0.0123");
		expect(screen.getByTestId("usage-requests")).toHaveTextContent("2");
		expect(screen.getByTestId("usage-cacheWrite")).toHaveTextContent("1,000");

		// Per-request rows are table cells now, not a run of inline text.
		const firstCells = within(screen.getByTestId("usage-call-1"))
			.getAllByRole("cell")
			.map((cell) => cell.textContent);
		// #, input, cached, cache write, output
		expect(firstCells[1]).toBe("1,000");
		expect(firstCells[2]).toContain("0%");
		expect(firstCells[3]).toBe("1,000");
		expect(screen.getByTestId("usage-call-2")).toHaveTextContent("1,100");
		expect(screen.getByTestId("usage-call-2")).toHaveTextContent("91%");
	});

	/**
	 * Labels used to sit on the same line as their numbers, so a seven-digit
	 * count ran into the next cell whenever the chat column was narrow. Each
	 * label now has its own element above its value.
	 */
	it("keeps every label in its own element, apart from its number", () => {
		renderFooter({
			prompt_tokens: 1_188_273,
			completion_tokens: 10_790,
			total_tokens: 1_199_070,
			cached_tokens: 916_224,
			cost: 0.1001,
			requests: 18,
			calls: [],
		});

		const input = screen.getByTestId("usage-input");
		expect(within(input).getByText("Input").tagName).toBe("DT");
		expect(within(input).getByText("1,188,273").tagName).toBe("DD");
		expect(screen.getByTestId("usage-cost")).toHaveTextContent("$0.1001");
	});

	it("lays out against its own width, not the window's", () => {
		// It lives in a resizable chat column, so viewport breakpoints picked the
		// wide layout for a narrow panel. Container queries size it to itself.
		renderFooter({
			prompt_tokens: 10,
			completion_tokens: 1,
			total_tokens: 11,
			cached_tokens: 0,
		});

		expect(screen.getByTestId("message-usage-details").className).toContain(
			"@container",
		);
	});

	it("puts per-request numbers in aligned columns under one header", () => {
		renderFooter({
			prompt_tokens: 3000,
			completion_tokens: 30,
			total_tokens: 3030,
			cached_tokens: 900,
			requests: 2,
			calls: [
				{
					prompt_tokens: 1000,
					completion_tokens: 10,
					total_tokens: 1010,
					cached_tokens: 0,
				},
				{
					prompt_tokens: 2000,
					completion_tokens: 20,
					total_tokens: 2020,
					cached_tokens: 900,
				},
			],
		});

		const table = screen.getByRole("table");
		const headers = within(table)
			.getAllByRole("columnheader")
			.map((cell) => cell.textContent);
		expect(headers).toEqual(["#", "Input", "Cached", "Output"]);
		// Labels appear once in the header, not repeated on every row.
		expect(
			within(screen.getByTestId("usage-call-2")).queryByText("Input"),
		).toBeNull();
	});

	it("only adds a cache-write column when a request actually wrote", () => {
		renderFooter({
			prompt_tokens: 3000,
			completion_tokens: 30,
			total_tokens: 3030,
			cached_tokens: 900,
			requests: 2,
			calls: [
				{
					prompt_tokens: 1000,
					completion_tokens: 10,
					total_tokens: 1010,
					cached_tokens: 0,
				},
				{
					prompt_tokens: 2000,
					completion_tokens: 20,
					total_tokens: 2020,
					cached_tokens: 900,
				},
			],
		});

		expect(
			within(screen.getByRole("table")).queryByRole("columnheader", {
				name: "Cache write",
			}),
		).toBeNull();
	});

	/**
	 * The point of the breakdown: a turn can show 84% and 88% on most rows while
	 * quietly re-reading tens of thousands of tokens, because some requests
	 * reused an older prefix instead of the one just before. Those rows are
	 * called out so it does not have to be worked out by hand.
	 */
	it("calls out the requests that did not reuse the previous one", () => {
		renderFooter({
			prompt_tokens: 208_000,
			completion_tokens: 40,
			total_tokens: 208_040,
			cached_tokens: 135_000,
			requests: 3,
			calls: [
				{
					prompt_tokens: 63_417,
					completion_tokens: 10,
					total_tokens: 63_427,
					cached_tokens: 60_160,
				},
				{
					prompt_tokens: 66_185,
					completion_tokens: 10,
					total_tokens: 66_195,
					cached_tokens: 24_704,
				},
				{
					prompt_tokens: 71_653,
					completion_tokens: 20,
					total_tokens: 71_673,
					cached_tokens: 0,
				},
			],
		});

		expect(screen.getByTestId("usage-call-1").dataset.continuity).toBe("first");
		expect(screen.getByTestId("usage-call-2").dataset.continuity).toBe(
			"partial",
		);
		expect(screen.getByTestId("usage-call-3").dataset.continuity).toBe(
			"restarted",
		);
		expect(screen.getByTestId("usage-cache-misses")).toHaveTextContent(
			"2 requests didn't reuse the previous one",
		);
	});

	it("stays quiet about misses when every request reused the last", () => {
		renderFooter({
			prompt_tokens: 30_000,
			completion_tokens: 30,
			total_tokens: 30_030,
			cached_tokens: 19_900,
			requests: 2,
			calls: [
				{
					prompt_tokens: 10_000,
					completion_tokens: 10,
					total_tokens: 10_010,
					cached_tokens: 0,
				},
				{
					prompt_tokens: 20_000,
					completion_tokens: 20,
					total_tokens: 20_020,
					cached_tokens: 9_936,
				},
			],
		});

		expect(screen.queryByTestId("usage-cache-misses")).toBeNull();
		expect(screen.getByTestId("usage-call-2").dataset.continuity).toBe(
			"continued",
		);
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
