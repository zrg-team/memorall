import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runDecisionGeneration: vi.fn(async () => ({ parts: [] })),
	state: {
		modes: {
			decision: {
				conversations: [{ id: "session-1", title: "Support tickets" }],
			},
		},
		addItem: vi.fn(async () => ({
			id: "item-1",
			conversationId: "session-1",
			category: "decision",
			content: "Loving it",
			parts: [],
			generation: {},
			createdAt: new Date(0),
		})),
		updateItem: vi.fn(async () => undefined),
	},
}));

vi.mock("@/services", () => ({ serviceManager: {} }));
vi.mock("@/main/stores/studio", () => ({
	markGenerationActive: vi.fn(),
	useStudioStore: { getState: () => mocks.state },
}));
vi.mock("@/services/studio/studio-generations", () => ({
	runDecisionGeneration: mocks.runDecisionGeneration,
	runImageGeneration: vi.fn(),
	runImageToolGeneration: vi.fn(),
	runSpeechGeneration: vi.fn(),
	runTextToolGeneration: vi.fn(),
	runTranscription: vi.fn(),
}));

import { runDecision } from "../studio-service";

describe("Studio page runs", () => {
	it("book their model requests to the session they land in, under their studio", async () => {
		await runDecision({
			model: {
				modelId: "judge",
				provider: "openrouter",
				serviceName: "openrouter",
			},
			input: "Loving it",
			questions: {},
		});
		expect(mocks.runDecisionGeneration).toHaveBeenCalledWith(
			expect.objectContaining({
				input: "Loving it",
				booking: {
					tool: "decision",
					sessionId: "session-1",
					title: "Support tickets",
				},
			}),
		);
	});
});
