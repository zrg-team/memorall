import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeteredLlmService } from "@/services/model-usage/metered-llm";
import { runOCRGeneration } from "../studio-generations";

vi.mock("@/services", () => ({ serviceManager: {} }));
vi.mock("@/services/llm/utils/media-payload", () => ({
	mediaPayloadToBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

const chat = vi.fn();
const model = {
	modelId: "org/vision-ocr",
	provider: "custom" as const,
	serviceName: "custom",
};
const options = () => ({
	model,
	image: {
		kind: "file" as const,
		path: "inputs/page.png",
		mimeType: "image/png",
	},
	fileName: "report.pdf",
	pageNumber: 1,
	instructions: "",
	llm: { chatCompletionsFor: chat } as unknown as MeteredLlmService,
});
const response = (content: string | null, finish_reason = "stop") => ({
	choices: [{ message: { content }, finish_reason }],
});

describe("OCR model requests", () => {
	it.each([
		["org/future-ocr", ""],
		["org/task-ocr", "Read the document:"],
	])(
		"runs %s through the on-device media runner without a server",
		async (modelId, prompt) => {
			const imagesToolsFor = vi.fn(async () => ({ text: "# Local document" }));
			const result = await runOCRGeneration({
				...options(),
				instructions: prompt,
				model: {
					modelId,
					provider: "transformer-media",
					serviceName: "transformer-media",
				},
				llm: { imagesToolsFor } as unknown as MeteredLlmService,
			});
			expect(imagesToolsFor).toHaveBeenCalledWith(
				"transformer-media",
				expect.objectContaining({
					model: modelId,
					task: "image-to-text",
					options: { prompt },
				}),
			);
			expect(result.parts).toEqual([
				{ type: "text", role: "transcript", text: "# Local document" },
			]);
			expect(chat).not.toHaveBeenCalled();
		},
	);
	beforeEach(() => {
		chat.mockReset().mockResolvedValue(response("# A document\n\nHello"));
	});
	it("uses the selected model and an explicitly configured image-only prompt", async () => {
		const result = await runOCRGeneration(options());
		expect(chat).toHaveBeenCalledWith(
			"custom",
			expect.objectContaining({
				model: model.modelId,
				stream: false,
				messages: [
					{
						role: "user",
						content: [
							{
								type: "image_url",
								image_url: { url: "data:image/png;base64,AQID" },
							},
						],
					},
				],
			}),
		);
		expect(result.parts).toEqual([
			{ type: "text", role: "transcript", text: "# A document\n\nHello" },
		]);
	});
	it("sends a custom model instruction exactly as configured", async () => {
		await runOCRGeneration({
			...options(),
			grounding: true,
			instructions: "grounding",
		});
		expect(chat.mock.calls[0]![1].messages[0].content[1]).toEqual({
			type: "text",
			text: "grounding",
		});
	});
	it("requests a common coordinate format for an arbitrary layout-capable model", async () => {
		await runOCRGeneration({
			...options(),
			instructions: undefined,
			grounding: true,
		});
		expect(chat.mock.calls[0]![1].messages[0].content[1].text).toContain(
			"![label](x1,y1,x2,y2)",
		);
	});
	it("keeps an unconfigured local model's default image-only request", async () => {
		const imagesToolsFor = vi.fn(async () => ({ text: "Local document" }));
		await runOCRGeneration({
			...options(),
			instructions: undefined,
			model: {
				...model,
				provider: "transformer-media",
				serviceName: "transformer-media",
			},
			llm: { imagesToolsFor } as unknown as MeteredLlmService,
		});
		expect(imagesToolsFor).toHaveBeenCalledWith(
			"transformer-media",
			expect.objectContaining({ options: { prompt: "" } }),
		);
	});
	it("supports another provider's vision model with an explicit transcription instruction", async () => {
		await runOCRGeneration({
			...options(),
			instructions: undefined,
			model: {
				modelId: "other-vision-model",
				provider: "openrouter",
				serviceName: "openrouter",
			},
		});
		expect(chat).toHaveBeenCalledWith(
			"openrouter",
			expect.objectContaining({ model: "other-vision-model" }),
		);
		expect(chat.mock.calls[0]![1].messages[0].content[1].text).toContain(
			"Transcribe all text",
		);
	});
	it.each([null, "", "   "])(
		"reports empty output instead of saving a successful blank result (%s)",
		async (content) => {
			chat.mockResolvedValue(response(content));
			await expect(runOCRGeneration(options())).rejects.toThrow(
				"returned no text",
			);
		},
	);
	it("reports truncation", async () => {
		chat.mockResolvedValue(response("incomplete", "length"));
		await expect(runOCRGeneration(options())).rejects.toThrow("output limit");
	});
	it("does not send a request after cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			runOCRGeneration({ ...options(), signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(chat).not.toHaveBeenCalled();
	});
	it("propagates provider errors so the saved generation can be marked failed", async () => {
		chat.mockRejectedValue(new Error("Vision is unsupported"));
		await expect(runOCRGeneration(options())).rejects.toThrow(
			"Vision is unsupported",
		);
	});
});
