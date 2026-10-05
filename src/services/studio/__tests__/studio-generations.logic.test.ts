import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	systemOneFor: vi.fn(async () => ({
		object: "systemone" as const,
		model: "judge",
		answers: {},
		usage: { input_tokens: 80, output_tokens: 6, cost: 0.0002 },
	})),
	record: vi.fn(async () => undefined),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			systemOneFor: mocks.systemOneFor,
			getInfoFor: (name: string) => ({ name, type: "openrouter", ready: true }),
		},
	},
}));

vi.mock("@/services/model-usage/model-usage-ledger", async (original) => ({
	...(await original<
		typeof import("@/services/model-usage/model-usage-ledger")
	>()),
	recordModelUsage: mocks.record,
}));

import { meterLlmService } from "@/services/model-usage/metered-llm";
import { runDecisionGeneration } from "../studio-generations";

const model = {
	modelId: "judge",
	provider: "openrouter" as const,
	serviceName: "openrouter",
};

describe("Studio generations", () => {
	it("are metered by default and booked to the Studio session they run in", async () => {
		await runDecisionGeneration({
			model,
			input: "Loving the new release!",
			questions: {},
			booking: {
				tool: "decision",
				sessionId: "studio-session-1",
				title: "Support tickets",
			},
		});
		expect(mocks.record).toHaveBeenCalledWith({
			source: "studio",
			tool: "decision",
			sessionId: "studio-session-1",
			title: "Support tickets",
			provider: "openrouter",
			model: "judge",
			usage: {
				prompt_tokens: 80,
				completion_tokens: 6,
				total_tokens: 86,
				cost: 0.0002,
			},
		});
	});

	it("run on a computer's own metered service when it passes one", async () => {
		const booked = vi.fn(async () => undefined);
		const llm = meterLlmService(
			{
				systemOneFor: mocks.systemOneFor,
				getInfoFor: () => ({ name: "x", type: "openrouter", ready: true }),
			} as never,
			() => ({
				source: "studio",
				tool: "memon_studio",
				agentId: "agent-1",
				sessionId: "memon:agent-1",
				title: "Studio · Decision",
			}),
			booked,
		);
		mocks.record.mockClear();
		await runDecisionGeneration({ model, input: "x", questions: {}, llm });
		expect(booked).toHaveBeenCalledWith(
			expect.objectContaining({ tool: "memon_studio", agentId: "agent-1" }),
		);
		expect(mocks.record).not.toHaveBeenCalled();
	});
});
