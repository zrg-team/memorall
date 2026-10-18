import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runDecisionGeneration: vi.fn(async () => ({ parts: [] })),
	runOCRGeneration: vi.fn(async () => ({
		parts: [{ type: "text", text: "# Report", role: "transcript" }],
	})),
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
	runOCRGeneration: mocks.runOCRGeneration,
	runImageGeneration: vi.fn(),
	runImageToolGeneration: vi.fn(),
	runSpeechGeneration: vi.fn(),
	runTextToolGeneration: vi.fn(),
	runTranscription: vi.fn(),
}));

import { extractOCR, runDecision } from "../studio-service";

describe("Studio page runs", () => {
	it("persists an OCR page with its selected model, source image and output", async () => {
		await extractOCR({
			model: {
				modelId: "org/vision-ocr",
				provider: "custom",
				serviceName: "custom",
			},
			image: { kind: "file", path: "inputs/page.png", mimeType: "image/png" },
			fileName: "report.pdf",
			pageNumber: 2,
			pageCount: 5,
			batchId: "conversion-1",
			selectedPages: [2, 4],
			instructions: "Read this page:",
		});
		expect(mocks.state.addItem).toHaveBeenCalledWith(
			"ocr",
			expect.objectContaining({
				content: "report.pdf",
				parts: [
					{
						type: "image",
						image: {
							path: "inputs/page.png",
							mimeType: "image/png",
							role: "input",
						},
					},
				],
				generation: expect.objectContaining({
					category: "ocr",
					modelId: "org/vision-ocr",
					status: "running",
					params: expect.objectContaining({
						pageNumber: 2,
						pageCount: 5,
						batchId: "conversion-1",
						selectedPages: [2, 4],
						instructions: "Read this page:",
					}),
				}),
			}),
		);
		expect(mocks.state.updateItem).toHaveBeenCalledWith(
			"ocr",
			"item-1",
			expect.objectContaining({
				parts: expect.arrayContaining([
					{ type: "text", text: "# Report", role: "transcript" },
				]),
				generation: expect.objectContaining({ status: "done" }),
			}),
		);
	});
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
