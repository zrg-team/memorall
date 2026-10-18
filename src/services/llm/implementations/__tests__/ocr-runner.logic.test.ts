import { describe, expect, it, vi } from "vitest";
import {
	loadOCRBundle,
	runDocumentOCR,
} from "../../../../../public/runner/modes/media/ocr.js";
import { createCancellation } from "../../../../../public/runner/modes/media/cancellation.js";

function fixture() {
	const input = { dims: [1, 4], dispose: vi.fn() };
	const pixels = { dispose: vi.fn() };
	const generated = { dims: [1, 3], dispose: vi.fn() };
	const output = { slice: vi.fn(() => generated), dispose: vi.fn() };
	const processor = Object.assign(
		vi.fn(async () => ({ input_ids: input, pixel_values: pixels })),
		{
			chat_template: "chat template" as string | null,
			apply_chat_template: vi.fn(() => "template"),
			batch_decode: vi.fn(() => ["# Local OCR"]),
		},
	);
	const model = {
		config: { is_encoder_decoder: false },
		generate: vi.fn(async () => output),
		dispose: vi.fn(),
	};
	const stopping = { interrupt: vi.fn() };
	const transformers = {
		RawImage: { fromBlob: vi.fn(async () => "decoded-image") },
		AutoProcessor: { from_pretrained: vi.fn(async () => processor) },
		AutoModelForImageTextToText: { from_pretrained: vi.fn(async () => model) },
		InterruptableStoppingCriteria: vi.fn(function () {
			return stopping;
		}),
	};
	const bundle = {
		id: "org/ocr",
		task: "image-text-to-text",
		device: "wasm",
		model,
		processor,
	};
	const cancellation = createCancellation();
	const payload = {
		task: "image-to-text",
		image: new Uint8Array([1, 2]),
		mimeType: "image/png",
		options: { prompt: "" },
	};
	return {
		input,
		pixels,
		generated,
		output,
		processor,
		model,
		stopping,
		transformers,
		bundle,
		cancellation,
		payload,
	};
}

describe("native OCR runner", () => {
	it("loads the selected ONNX model and processor and disposes the model on unload", async () => {
		const test = fixture();
		const options = { device: "wasm", dtype: "q4", progress_callback: vi.fn() };
		const bundle = await loadOCRBundle({
			transformers: test.transformers,
			config: { id: "org/ocr", task: "image-text-to-text" },
			device: "wasm",
			dtype: "q4",
			options,
		});
		expect(
			test.transformers.AutoModelForImageTextToText.from_pretrained,
		).toHaveBeenCalledWith("org/ocr", options);
		expect(bundle.task).toBe("image-text-to-text");
		await bundle.pipe.dispose();
		expect(test.model.dispose).toHaveBeenCalledOnce();
	});
	it("prepares a document image, strips prompt tokens and frees generation tensors", async () => {
		const test = fixture();
		expect(await runDocumentOCR(test)).toEqual({ text: "# Local OCR" });
		expect(test.processor).toHaveBeenCalledWith("decoded-image", "template");
		expect(test.processor.apply_chat_template).toHaveBeenCalledWith(
			[{ role: "user", content: [{ type: "image" }] }],
			{ add_generation_prompt: true, tokenize: false },
		);
		expect(test.output.slice).toHaveBeenCalledWith(null, [4, null]);
		for (const tensor of [test.input, test.pixels, test.output, test.generated])
			expect(tensor.dispose).toHaveBeenCalledOnce();
	});
	it("uses the selected model's OCR instruction", async () => {
		const test = fixture();
		test.payload.options.prompt = "Text Recognition:";
		await runDocumentOCR(test);
		expect(test.processor.apply_chat_template).toHaveBeenCalledWith(
			[
				{
					role: "user",
					content: [
						{ type: "image" },
						{ type: "text", text: "Text Recognition:" },
					],
				},
			],
			{ add_generation_prompt: true, tokenize: false },
		);
	});
	it("passes model instructions directly when its processor has no chat template", async () => {
		const test = fixture();
		test.processor.chat_template = null;
		test.payload.options.prompt = "<OCR>";
		await runDocumentOCR(test);
		expect(test.processor.apply_chat_template).not.toHaveBeenCalled();
		expect(test.processor).toHaveBeenCalledWith("decoded-image", "<OCR>");
	});
	it("keeps the full encoder-decoder result instead of removing source tokens", async () => {
		const test = fixture();
		test.model.config.is_encoder_decoder = true;
		await runDocumentOCR(test);
		expect(test.output.slice).toHaveBeenCalledWith(null, [0, null]);
	});
	it("interrupts generation on cancellation and releases input tensors", async () => {
		const test = fixture();
		test.model.generate.mockImplementation(async () => {
			test.cancellation.cancel();
			return test.output;
		});
		await expect(runDocumentOCR(test)).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(test.stopping.interrupt).toHaveBeenCalledOnce();
		expect(test.input.dispose).toHaveBeenCalledOnce();
		expect(test.output.dispose).toHaveBeenCalledOnce();
	});
	it("releases tensors after a model failure", async () => {
		const test = fixture();
		test.model.generate.mockRejectedValue(new Error("Out of memory"));
		await expect(runDocumentOCR(test)).rejects.toThrow("Out of memory");
		expect(test.input.dispose).toHaveBeenCalledOnce();
		expect(test.pixels.dispose).toHaveBeenCalledOnce();
	});
});
