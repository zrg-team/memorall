import { describe, expect, it, vi } from "vitest";
import { loadEmbeddingGemma2 } from "../../../../../public/runner/modes/embeddinggemma2.js";

const setup = async () => {
	const inputs = { input_ids: { dispose: vi.fn() } };
	const output = {
		sentence_embedding: {
			tolist: (): number[][] => [
				Array.from({ length: 768 }, (_, i) => (i === 0 ? 2 : 0)),
			],
			dispose: vi.fn(),
		},
	};
	const processor = vi.fn(async () => inputs);
	const model = Object.assign(
		vi.fn(async () => output),
		{ dispose: vi.fn() },
	);
	const HF = {
		AutoProcessor: { from_pretrained: vi.fn(async () => processor) },
		AutoModel: { from_pretrained: vi.fn(async () => model) },
		RawImage: { fromBlob: vi.fn(async (blob: Blob) => ({ size: blob.size })) },
		RawVideoFrame: class {
			constructor(
				readonly image: unknown,
				readonly timestamp: number,
			) {}
		},
		RawVideo: class {
			constructor(
				readonly frames: unknown[],
				readonly duration: number,
			) {}
		},
	};
	const runner = await loadEmbeddingGemma2(HF, "model", {
		device: "wasm",
		revision: "pinned",
	});
	return { runner, HF, processor, model, inputs, output };
};
describe("native multimodal embedding runner", () => {
	it("uses retrieval prefixes and the model's sentence projection with safe precision", async () => {
		const { runner, HF, processor, inputs, output } = await setup();
		await runner.embed({ kind: "text", text: "piano", query: true });
		expect(processor).toHaveBeenLastCalledWith(
			"task: search result | query: piano",
		);
		const vector = await runner.embed({
			kind: "text",
			text: "piano notes",
			title: "Music",
		});
		expect(processor).toHaveBeenLastCalledWith(
			"title: Music | text: piano notes",
		);
		expect(vector.length).toBe(768);
		expect(Math.hypot(...vector)).toBe(1);
		expect(HF.AutoModel.from_pretrained).toHaveBeenCalledWith(
			"model",
			expect.objectContaining({ dtype: "q4", revision: "pinned" }),
		);
		expect(inputs.input_ids.dispose).toHaveBeenCalledTimes(2);
		expect(output.sentence_embedding.dispose).toHaveBeenCalledTimes(2);
	});
	it("passes image and non-speech PCM to the native processor without text surrogates", async () => {
		const { runner, processor } = await setup();
		await runner.embed({
			kind: "image",
			bytes: new ArrayBuffer(4),
			mimeType: "image/png",
		});
		expect(processor).toHaveBeenLastCalledWith(null, { size: 4 });
		const samples = new Float32Array([0.1, -0.1]);
		await runner.embed({ kind: "audio", samples, sampleRate: 16000 });
		expect(processor).toHaveBeenLastCalledWith(null, null, samples);
		await expect(
			runner.embed({ kind: "audio", samples, sampleRate: 44100 }),
		).rejects.toThrow("16 kHz");
	});
	it("embeds sampled video as a RawVideo preserving ordered frame times", async () => {
		const { runner, processor } = await setup();
		await runner.embed({
			kind: "video",
			frames: [
				{ bytes: new ArrayBuffer(3), timestamp: 0 },
				{ bytes: new ArrayBuffer(6), timestamp: 1 },
			],
			duration: 2,
		});
		expect(processor).toHaveBeenLastCalledWith(
			null,
			null,
			null,
			expect.objectContaining({
				duration: 2,
				frames: [
					expect.objectContaining({ timestamp: 0 }),
					expect.objectContaining({ timestamp: 1 }),
				],
			}),
		);
		await expect(
			runner.embed({ kind: "video", frames: [], duration: 1 }),
		).rejects.toThrow("1–32 frames");
	});
	it("rejects corrupt vectors and releases inputs even when inference fails", async () => {
		const { runner, model, inputs, output } = await setup();
		output.sentence_embedding.tolist = () => [[NaN]];
		await expect(runner.embed({ kind: "text", text: "test" })).rejects.toThrow(
			"invalid",
		);
		model.mockRejectedValueOnce(new Error("Device lost"));
		await expect(runner.embed({ kind: "text", text: "test" })).rejects.toThrow(
			"Device lost",
		);
		expect(inputs.input_ids.dispose).toHaveBeenCalledTimes(2);
	});
});
