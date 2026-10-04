import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageRequest } from "../../types";

const mocks = vi.hoisted(() => ({
	requests: [] as UsageRequest[],
	loadConversation: vi.fn(),
	store: new Map<string, unknown>(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			typeof options?.defaultValue === "string" ? options.defaultValue : key,
		i18n: { language: "en" },
	}),
	Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

vi.mock("../../services/usage-repository", () => ({
	loadUsageRequests: async () => mocks.requests,
	loadReportedSpend: async () => 1.5,
	loadFeatureLabels: () => new Map([["step-web", "Web Browser"]]),
}));

vi.mock("@/platform/current", () => ({
	platform: {
		persistentStore: {
			get: async (key: string) => mocks.store.get(key),
			set: async (key: string, value: unknown) => {
				mocks.store.set(key, value);
			},
			remove: async (key: string) => {
				mocks.store.delete(key);
			},
		},
	},
}));

vi.mock("@/main/stores/chat", () => ({
	useChatStore: {
		getState: () => ({ loadConversation: mocks.loadConversation }),
	},
}));

import { UsageDashboard } from "../UsageDashboard";

const HOUR = 3_600_000;

const request = (overrides: Partial<UsageRequest>): UsageRequest => ({
	messageId: "m",
	conversationId: "c1",
	conversationTitle: "Compare lease offers",
	at: Date.now() - HOUR,
	agent: "Research Scout",
	model: "anthropic/claude-sonnet-4.5",
	provider: "openrouter",
	local: false,
	cost: 2,
	inputTokens: 1000,
	cachedTokens: 400,
	outputTokens: 100,
	reasoningTokens: 0,
	estimated: false,
	tools: [],
	...overrides,
});

describe("UsageDashboard", () => {
	beforeEach(() => {
		mocks.store.clear();
		mocks.loadConversation.mockReset();
		mocks.requests = [
			request({}),
			request({
				messageId: "m2",
				agent: "",
				conversationId: "c2",
				conversationTitle: "Weekly reading list",
				model: "gpt-5.6-terra",
				provider: "openai",
				cost: 1,
				tools: [
					{
						tool: "web_read",
						feature: "step-web",
						weight: 1,
						resultChars: 4000,
						calls: 1,
					},
				],
			}),
			request({
				messageId: "m3",
				agent: "Inbox Triage",
				conversationId: "c3",
				model: "qwen2.5-7b-instruct.gguf",
				provider: "wllama",
				local: true,
				cost: 0,
			}),
			// OpenAI direct reports no cost: counted in tokens, never as $0.
			request({
				messageId: "m4",
				agent: "Daily Briefing",
				conversationId: "c4",
				model: "gpt-5.6-luna",
				provider: "openai",
				cost: undefined,
				inputTokens: 1000,
				outputTokens: 100,
			}),
		];
	});

	it("shows totals and every section for the loaded usage", async () => {
		render(<UsageDashboard />);

		expect(await screen.findByText("$3.00")).toBeInTheDocument();
		expect(screen.getByText("trend.titleCost")).toBeInTheDocument();
		expect(screen.getByText("features.titleCost")).toBeInTheDocument();
		expect(screen.getByText("tools.titleCost")).toBeInTheDocument();
		expect(screen.getByText("conversations.title")).toBeInTheDocument();
		// Tools show up by name, attributed to the catalog feature.
		expect(screen.getByText("web_read")).toBeInTheDocument();
		expect(screen.getAllByText("Web Browser").length).toBeGreaterThan(0);
	});

	it("filters every card when a row is clicked, and clears it again", async () => {
		render(<UsageDashboard />);
		await screen.findByText("$3.00");

		const agentRow = screen
			.getAllByRole("button", { pressed: false })
			.find((button) => within(button).queryByText("Research Scout"));
		if (!agentRow) throw new Error("no agent row");
		fireEvent.click(agentRow);

		expect(screen.queryByText("$3.00")).not.toBeInTheDocument();
		expect(screen.getAllByText("$2.00").length).toBeGreaterThan(0);
		expect(screen.queryByText("web_read")).not.toBeInTheDocument();

		fireEvent.click(screen.getByText("filters.reset"));
		expect(await screen.findByText("$3.00")).toBeInTheDocument();
	});

	it("shows tokens where the provider reported no price", async () => {
		render(<UsageDashboard />);
		await screen.findByText("$3.00");

		// Hero: the unpriced tokens next to the money.
		expect(screen.getByText("summary.unpricedTokens")).toBeInTheDocument();
		// A row with no priced request shows its tokens instead of $0.00.
		const briefing = screen
			.getAllByRole("button")
			.find((button) => within(button).queryByText("Daily Briefing"));
		if (!briefing) throw new Error("no Daily Briefing row");
		expect(within(briefing).getByText("1.1K")).toBeInTheDocument();
		expect(
			within(briefing).getByText("summary.tokensUnit"),
		).toBeInTheDocument();
		expect(within(briefing).queryByText("$0.00")).not.toBeInTheDocument();
		// A row with both shows money plus the unpriced tokens (OpenAI here).
		expect(screen.getAllByText("summary.plusTokens").length).toBeGreaterThan(0);
	});

	it("switches every card to tokens", async () => {
		render(<UsageDashboard />);
		await screen.findByText("$3.00");

		fireEvent.click(screen.getByRole("radio", { name: "measure.tokens" }));

		expect(screen.getByText("trend.titleTokens")).toBeInTheDocument();
		expect(screen.getByText("tools.titleTokens")).toBeInTheDocument();
	});

	it("opens a conversation from the table", async () => {
		render(<UsageDashboard />);
		fireEvent.click(await screen.findByText("Weekly reading list"));
		expect(mocks.loadConversation).toHaveBeenCalledWith("c2");
	});

	it("explains the page when nothing has been used yet", async () => {
		mocks.requests = [];
		render(<UsageDashboard />);
		expect(await screen.findByText("empty.title")).toBeInTheDocument();
	});
});
